import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createLogFilePath, createLogger, flushLogger } from "./logger";

test("redacts sensitive top-level fields", () => {
  const lines: string[] = [];
  const logger = createLogger({
    destination: {
      write(message) {
        lines.push(message);
      },
    },
  });

  logger.info(
    {
      apiKey: "api-key",
      event: "test",
      token: "token",
    },
    "test message",
  );

  const entry = JSON.parse(lines[0] ?? "{}");
  assert.equal(entry.apiKey, "[Redacted]");
  assert.equal(entry.token, "[Redacted]");
  assert.equal(entry.event, "test");
  assert.equal(entry.msg, "test message");
});

test("persists JSONL records when a log file path is configured", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "klein-logger-"));
  const filePath = createLogFilePath(rootDirectory, new Date("2026-09-11T00:00:00.000Z"));

  try {
    const logger = createLogger({ filePath });
    logger.info({ event: "file_test", value: 42 }, "written to file");
    flushLogger(logger);

    const lines = (await readFile(filePath, "utf8")).trim().split("\n");
    const entry = JSON.parse(lines[0] ?? "{}");
    assert.equal(entry.event, "file_test");
    assert.equal(entry.value, 42);
    assert.equal(entry.msg, "written to file");
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});
