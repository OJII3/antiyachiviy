import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createLogger } from "@app/logger";
import { createPythonAntigravityAgentFactory } from "./python-agent-runtime";

test("passes image content through the Python worker and stores its conversation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yachigravity-python-agent-"));
  const command = join(directory, "fake-python-worker");
  const configurationPath = join(directory, "configuration.json");
  const promptPath = join(directory, "prompt.json");
  await writeFile(
    command,
    `#!/bin/sh
read -r configure
printf '%s' "$configure" > "${configurationPath}"
printf '%s\\n' '{"event":"init","conversation_id":"python-conversation"}'
while IFS= read -r line; do
  printf '%s' "$line" > "${promptPath}"
  printf '%s\\n' '{"event":"step_update","step_update":{"step_type":"tool","tool_name":"discord_send","tool_info":{"output":"sent"}}}'
  printf '%s\\n' '{"event":"result","result":{"conversation_id":"python-conversation","status":"SUCCESS","response":"duplicate"}}'
done
`,
    "utf8",
  );
  await chmod(command, 0o755);

  const factory = createPythonAntigravityAgentFactory({
    agentDir: directory,
    discordSendGateway: {
      registerChannel(channelId) {
        assert.equal(channelId, "123");
        return { endpoint: "http://127.0.0.1:1/discord-send", token: "token" };
      },
    },
    llm: {
      dangerouslySkipPermissions: false,
      model: "gemini-test",
    },
    logger: createLogger({ level: "silent" }),
    mcpServerPath: "/tmp/discord-send-mcp",
    pythonCommand: command,
    pythonProjectDirectory: directory,
    sessionMode: "resume",
  });
  const runtime = await factory.create(
    { systemPrompt: "system" },
    { sessionKey: "discord-channel:123" },
  );

  try {
    assert.equal(
      await runtime.prompt({
        text: "この画像を見て",
        images: [{ data: "cG5nLWJ5dGVz", mimeType: "image/png" }],
      }),
      "",
    );
  } finally {
    runtime.dispose();
  }

  const configuration = JSON.parse(await readFile(configurationPath, "utf8")) as {
    conversationId?: string;
    model?: string;
    mcpArgs?: string[];
    mcpCommand?: string;
    systemPrompt: string;
    workspace: string;
  };
  assert.match(configuration.systemPrompt, /^system\n\n/);
  assert.match(configuration.systemPrompt, /discord_send/);
  assert.equal(configuration.model, "gemini-test");
  assert.equal(configuration.mcpCommand, process.execPath);
  assert.deepEqual(configuration.mcpArgs, ["/tmp/discord-send-mcp"]);
  assert.match(configuration.workspace, /workspaces\/discord-channel%3A123$/);

  const prompt = JSON.parse(await readFile(promptPath, "utf8")) as {
    message: { content: string; images: { data: string; mimeType: string }[] };
  };
  assert.equal(prompt.message.content, "この画像を見て");
  assert.deepEqual(prompt.message.images, [{ data: "cG5nLWJ5dGVz", mimeType: "image/png" }]);

  const sessionFiles = await readdir(join(directory, "sessions", "discord-channel%3A123"));
  assert.equal(sessionFiles.length, 1);
  const session = JSON.parse(
    await readFile(join(directory, "sessions", "discord-channel%3A123", sessionFiles[0]!), "utf8"),
  ) as {
    backend: string;
    conversationId: string;
    events: { kind: string }[];
  };
  assert.equal(session.backend, "python-sdk");
  assert.equal(session.conversationId, "python-conversation");
  assert.deepEqual(
    session.events.map((event) => event.kind),
    ["user", "tool", "assistant"],
  );
});
