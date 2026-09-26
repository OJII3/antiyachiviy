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
      }),
      "reply\n",
    );
    assert.equal(await runtime.prompt({ text: "again" }), "reply\n");
  } finally {
    runtime.dispose();
  }

  const sessionDirectory = join(directory, "sessions", encodeURIComponent("discord-channel:123"));
  const sessionFiles = await readdir(sessionDirectory);
  assert.equal(sessionFiles.length, 1);
  const session = JSON.parse(await readFile(join(sessionDirectory, sessionFiles[0]!), "utf8")) as {
    conversationId: string;
    events: { kind: string; summary: string }[];
  };
  assert.equal(session.conversationId, "conversation-123");
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

test("adds character-focused, body-only reply instructions to the first prompt", () => {
  const initialPrompt = formatPrompt("system", "hello", false);
  const nextPrompt = formatPrompt("system", "again", true);

  assert.match(initialPrompt, /system/);
  assert.match(initialPrompt, /このキャラクターなら何を感じ、どう話すか/);
  assert.match(initialPrompt, /返答例/);
  assert.match(initialPrompt, /鍵括弧で囲まず/);
  assert.doesNotMatch(initialPrompt, /view_file|画像ファイル/);
  assert.equal(nextPrompt, "again");
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
