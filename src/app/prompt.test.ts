import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadPromptFile } from "./prompt";

test("loads and trims an external system prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "klein-prompt-"));
  try {
    const promptPath = join(directory, "SOUL.md");
    await writeFile(promptPath, "\n  Be helpful.\n\n", "utf8");

    assert.equal(await loadPromptFile(promptPath), "Be helpful.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a missing system prompt", async () => {
  await assert.rejects(loadPromptFile("config/does-not-exist.md"), /System prompt was not found:/);
});
