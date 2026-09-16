import assert from "node:assert/strict";
import test from "node:test";

import { DiscordOperatingState } from "./discord-operating-state";

test("starts active by default", () => {
  const state = new DiscordOperatingState();

  assert.equal(state.mode, "active");
  assert.equal(state.isActive(), true);
});

test("changes between active and paused", () => {
  const state = new DiscordOperatingState();

  state.setMode("paused");
  assert.equal(state.mode, "paused");
  assert.equal(state.isActive(), false);

  state.setMode("active");
  assert.equal(state.mode, "active");
  assert.equal(state.isActive(), true);
});
