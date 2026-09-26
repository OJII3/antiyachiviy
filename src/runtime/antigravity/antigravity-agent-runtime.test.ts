import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createLogger } from "@app/logger";
import {
  buildAntigravityArgs,
  createAntigravityAgentFactory,
  formatPrompt,
  parseStreamEvent,
} from "./antigravity-agent-runtime";
import { openSession, writeSession } from "./session-store";

test("drives a persistent stream-json process and stores the conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yachigravity-antigravity-"));
  const command = join(directory, "fake-agy");
  await writeFile(
    command,
    `#!/bin/sh
printf '%s\\n' '{"event":"init","conversation_id":"conversation-123"}'
while IFS= read -r _line; do
  printf '%s\\n' '{"event":"step_update","step_update":{"step_type":"tool","tool_name":"run_command","tool_info":{"output":"ok"}}}'
  printf '%s\\n' '{"event":"result","result":{"conversation_id":"conversation-123","status":"SUCCESS","response":"reply\\n"}}'
done
`,
    "utf8",
  );
  await chmod(command, 0o755);

  const logger = createLogger({ level: "silent" });
  const factory = createAntigravityAgentFactory({
    agentDir: directory,
    llm: {
      command,
      printTimeoutSeconds: 30,
      dangerouslySkipPermissions: false,
    },
    logger,
    sessionMode: "resume",
  });
  const runtime = await factory.create(
    { systemPrompt: "system" },
    { sessionKey: "discord-channel:123" },
  );

  try {
    assert.equal(
      await runtime.prompt({
        text: "hello",
        images: [{ data: "cG5nLWJ5dGVz", mimeType: "image/png" }],
      }),
      "reply\n",
    );
    assert.equal(await runtime.prompt({ text: "again", images: [] }), "reply\n");
  } finally {
    runtime.dispose();
  }

  const sessionDirectory = join(directory, "sessions", encodeURIComponent("discord-channel:123"));
  const sessionFiles = await readdir(sessionDirectory);
  assert.equal(sessionFiles.length, 1);
  const session = JSON.parse(await readFile(join(sessionDirectory, sessionFiles[0]!), "utf8")) as {
    id: string;
    conversationId: string;
    events: { kind: string; summary: string }[];
  };
  assert.equal(session.conversationId, "conversation-123");
  const imageDirectory = join(
    directory,
    "workspaces",
    encodeURIComponent("discord-channel:123"),
    "attachments",
    session.id,
  );
  const imageFiles = await readdir(imageDirectory);
  assert.equal(imageFiles.length, 1);
  assert.equal(await readFile(join(imageDirectory, imageFiles[0]!), "utf8"), "png-bytes");
  assert.deepEqual(
    session.events.map((event) => event.kind),
    ["user", "tool", "assistant", "user", "tool", "assistant"],
  );
});

test("builds headless stream-json arguments", () => {
  assert.deepEqual(
    buildAntigravityArgs({
      agent: "discord-agent",
      conversationId: "conversation-123",
      dangerouslySkipPermissions: true,
      effort: "high",
      model: "gemini-model",
      printTimeoutSeconds: 900,
    }),
    [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--conversation",
      "conversation-123",
      "--model",
      "gemini-model",
      "--agent",
      "discord-agent",
      "--effort",
      "high",
      "--print-timeout",
      "900s",
      "--dangerously-skip-permissions",
    ],
  );
});

test("parses only supported stream-json events", () => {
  assert.equal(parseStreamEvent({ event: "future_event" }), undefined);
  assert.equal(parseStreamEvent({ event: "result", result: "invalid" })?.event, "result");
  assert.equal(parseStreamEvent("invalid"), undefined);
});

test("instructs agy to inspect attached images with view_file", () => {
  const prompt = formatPrompt("system", "describe this", ["/tmp/image.png"], true);
  const initialPrompt = formatPrompt("system", "hello", [], false);

  assert.match(prompt, /画像ファイル: \/tmp\/image\.png/);
  assert.match(prompt, /必ず view_file ツールで開いて内容を確認してください/);
  assert.match(prompt, /画像を確認できない場合は推測せず/);
  assert.match(initialPrompt, /system/);
  assert.doesNotMatch(initialPrompt, /discord_send|Discord の中継/);
});

test("resumes the latest channel session and creates a new one when requested", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yachigravity-session-store-"));
  const first = await openSession({
    agentDirectory: directory,
    mode: "new",
    sessionKey: "discord-channel:123",
  });
  await writeSession(first.path, {
    ...first.value,
    conversationId: "conversation-123",
    modified: "2026-09-14T00:00:01.000Z",
  });

  const resumed = await openSession({
    agentDirectory: directory,
    mode: "resume",
    sessionKey: "discord-channel:123",
  });
  const fresh = await openSession({
    agentDirectory: directory,
    mode: "new",
    sessionKey: "discord-channel:123",
  });

  assert.equal(resumed.value.id, first.value.id);
  assert.equal(resumed.value.conversationId, "conversation-123");
  assert.notEqual(fresh.value.id, first.value.id);
});
