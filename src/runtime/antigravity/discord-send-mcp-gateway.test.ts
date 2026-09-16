import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { once } from "node:events";

import { createLogger } from "@app/logger";
import { DiscordSendMcpGateway } from "./discord-send-mcp-gateway";

test("routes discord_send requests to the registered channel", async () => {
  const sent: { channelId: string; content: string }[] = [];
  const gateway = new DiscordSendMcpGateway(
    {
      async sendMessage(channelId, content) {
        sent.push({ channelId, content });
      },
    },
    createLogger({ level: "silent" }),
  );
  await gateway.start();

  try {
    const credentials = gateway.registerChannel("channel-123");
    const response = await fetch(credentials.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "hello Discord" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(sent, [{ channelId: "channel-123", content: "hello Discord" }]);

    const unauthorized = await fetch(credentials.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "should not send" }),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(sent.length, 1);
  } finally {
    await gateway.stop();
  }
});

test("serves discord_send over the MCP stdio protocol", async () => {
  const sent: { channelId: string; content: string }[] = [];
  const gateway = new DiscordSendMcpGateway(
    {
      async sendMessage(channelId, content) {
        sent.push({ channelId, content });
      },
    },
    createLogger({ level: "silent" }),
  );
  await gateway.start();

  const credentials = gateway.registerChannel("channel-456");
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), "discord-send-mcp.ts");
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      YACHIGRAVITY_DISCORD_SEND_ENDPOINT: credentials.endpoint,
      YACHIGRAVITY_DISCORD_SEND_TOKEN: credentials.token,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const readResponse = async (): Promise<Record<string, unknown>> => {
    const next = await iterator.next();
    if (next.done) throw new Error("MCP server exited without a response");
    return JSON.parse(next.value) as Record<string, unknown>;
  };

  try {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
    );
    const initialized = await readResponse();
    assert.deepEqual(initialized.result, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "yachigravity-discord", version: "0.1.0" },
    });

    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    child.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
    const listed = await readResponse();
    assert.deepEqual(
      (listed.result as { tools: { name: string }[] }).tools[0]?.name,
      "discord_send",
    );

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "discord_send", arguments: { content: "hello from MCP" } },
      })}\n`,
    );
    const called = await readResponse();
    assert.equal(called.id, 3);
    assert.equal((called.result as { isError?: boolean }).isError, undefined);
    assert.deepEqual(sent, [{ channelId: "channel-456", content: "hello from MCP" }]);
  } finally {
    child.stdin.end();
    if (child.exitCode === null) {
      await once(child, "exit");
    }
    await gateway.stop();
  }
});
