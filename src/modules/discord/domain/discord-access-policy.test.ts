import assert from "node:assert/strict";
import test from "node:test";

import { createDiscordAccessPolicy } from "./discord-access-policy";

const policy = createDiscordAccessPolicy({
  default: "deny",
  directMessages: "allow",
  guilds: {
    guild: {
      access: "allow",
      channels: {
        denied: { access: "deny" },
        inherited: {
          threads: {
            allowed: { access: "allow" },
          },
        },
      },
    },
  },
});

test("uses directMessages for direct messages", () => {
  assert.equal(policy.canReceive({ channelId: "dm" }), true);
});

test("resolves guild access from guild to default", () => {
  assert.equal(policy.canReceive({ guildId: "guild", channelId: "other" }), true);
  assert.equal(policy.canReceive({ guildId: "other", channelId: "other" }), false);
});

test("resolves thread access after channel access", () => {
  assert.equal(
    policy.canReceive({ guildId: "guild", channelId: "denied", threadId: "other" }),
    false,
  );
  assert.equal(
    policy.canReceive({ guildId: "guild", channelId: "inherited", threadId: "allowed" }),
    true,
  );
  assert.equal(
    policy.canReceive({ guildId: "guild", channelId: "inherited", threadId: "other" }),
    true,
  );
});
