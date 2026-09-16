import assert from "node:assert/strict";
import test from "node:test";

import { parseCliOptions } from "./cli-options";

test("resumes sessions by default", () => {
  assert.deepEqual(parseCliOptions([]), { sessionMode: "resume" });
  assert.deepEqual(parseCliOptions(["--resume"]), { sessionMode: "resume" });
});

test("supports starting new sessions", () => {
  assert.deepEqual(parseCliOptions(["--new"]), { sessionMode: "new" });
});

test("rejects conflicting session options", () => {
  assert.throws(
    () => parseCliOptions(["--new", "--resume"]),
    /Cannot use --resume and --new together/,
  );
});

test("rejects unknown options", () => {
  assert.throws(
    () => parseCliOptions(["--unknown"]),
    /Unknown option: --unknown\. Use --resume or --new\./,
  );
});
