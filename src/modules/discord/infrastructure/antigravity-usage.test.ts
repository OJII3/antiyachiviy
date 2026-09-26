import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createAntigravityUsageProvider, parseWeeklyUsage } from "./antigravity-usage";
import { formatWeeklyUsageActivity } from "../domain/weekly-usage";

test("parses the remaining weekly quota and reset time", () => {
  assert.deepEqual(
    parseWeeklyUsage(
      JSON.stringify({
        quota: {
          "gemini-weekly": {
            remaining_fraction: 0.73,
            reset_in_seconds: 172_800,
          },
        },
      }),
    ),
    { remainingPercentage: 73, resetInDays: 2 },
  );
});

test("parses structured usage JSON nested in the print response", () => {
  assert.deepEqual(
    parseWeeklyUsage(
      JSON.stringify({
        response: JSON.stringify({
          buckets: [{ id: "gemini-weekly", remaining_fraction: 0.5 }],
        }),
      }),
    ),
    { remainingPercentage: 50, resetInDays: undefined },
  );
});

test("formats the Discord activity with a fallback for unavailable usage", () => {
  assert.equal(
    formatWeeklyUsageActivity({ remainingPercentage: 73, resetInDays: 2 }),
    "73%/week (reset in 2 days)",
  );
  assert.equal(formatWeeklyUsageActivity(undefined), "--%/week (reset in -- days)");
});

test("gets usage through agy's non-interactive usage command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yachigravity-usage-"));
  const command = join(directory, "fake-agy");
  await writeFile(
    command,
    `#!/bin/sh
if [ "$1" != "-p" ] || [ "$2" != "/usage" ] || [ "$3" != "--output-format" ] || [ "$4" != "json" ]; then
  exit 2
fi
printf '%s\\n' '{"quota":{"gemini-weekly":{"remaining_fraction":0.64,"reset_in_seconds":86400}}}'
`,
    "utf8",
  );
  await chmod(command, 0o755);

  try {
    const usage = await createAntigravityUsageProvider(command).getWeeklyUsage();
    assert.deepEqual(usage, { remainingPercentage: 64, resetInDays: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
