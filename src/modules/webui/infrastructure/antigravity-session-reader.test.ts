import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { AntigravitySessionReader } from "./antigravity-session-reader";
import { openSession, writeSession } from "@runtime/antigravity/session-store";

test("lists and reads Antigravity sessions without image data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yachigravity-session-reader-"));
  const handle = await openSession({
    agentDirectory: directory,
    mode: "new",
    sessionKey: "discord-channel:123",
  });
  await writeSession(handle.path, {
    ...handle.value,
    conversationId: "conversation-123",
    events: [
      {
        id: "user-event",
        kind: "user",
        role: "user",
        summary: "hello",
        content: "hello",
        timestamp: "2026-09-14T00:00:00.000Z",
      },
      {
        id: "assistant-event",
        kind: "assistant",
        role: "assistant",
        summary: "hello back",
        content: "hello back",
        timestamp: "2026-09-14T00:00:01.000Z",
      },
    ],
    modified: "2026-09-14T00:00:01.000Z",
  });

  const reader = new AntigravitySessionReader(directory);
  const sessions = await reader.list();
  assert.deepEqual(sessions[0], {
    id: handle.value.id,
    channelKey: "discord-channel:123",
    created: handle.value.created,
    modified: "2026-09-14T00:00:01.000Z",
    messageCount: 2,
    firstMessage: "hello",
  });

  const detail = await reader.get(handle.value.id);
  assert.equal(detail?.session.id, handle.value.id);
  assert.deepEqual(
    detail?.items.map((item) => item.kind),
    ["user", "assistant"],
  );
  assert.equal(await reader.get("missing"), undefined);
});

test("returns no sessions when the session directory is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yachigravity-session-reader-"));
  assert.deepEqual(await new AntigravitySessionReader(directory).list(), []);
});
