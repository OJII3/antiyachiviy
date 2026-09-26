import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDiscordMessage,
  formatDiscordUser,
  resolveDiscordMentions,
  type DiscordRole,
  type DiscordUser,
} from "./discord-message";

const user: DiscordUser = {
  bot: false,
  id: "123456789012345678",
  username: "satsuki",
  displayName: "さつき",
};

const bot: DiscordUser = {
  bot: true,
  id: "987654321098765432",
  username: "klein",
  displayName: "クライン",
};

const role: DiscordRole = {
  id: "111111111111111111",
  name: "開発チーム",
};

test("formats a Discord user with display name and username", () => {
  assert.equal(formatDiscordUser(user), "さつき (@satsuki)");
});

test("does not duplicate a username used as the display name", () => {
  assert.equal(formatDiscordUser({ ...user, displayName: user.username }), "satsuki");
});

test("formats a Discord message with reply content but without sender names or IDs", () => {
  assert.equal(
    formatDiscordMessage({
      author: user,
      channelId: "channel-123",
      content: "本文です",
      id: "message-456",
      images: [],
      replyTo: {
        author: bot,
        content: "返信元",
        id: "message-123",
      },
    }),
    "返信先のメッセージ:\n返信元\n\n本文です",
  );
});

test("formats message text without image attachment details", () => {
  assert.equal(
    formatDiscordMessage({
      author: user,
      channelId: "channel-123",
      content: "これを見て",
      id: "message-456",
      images: [
        {
          data: "c2VjcmV0",
          filename: "sample.png",
          id: "attachment-123",
          mimeType: "image/png",
        },
      ],
    }),
    "これを見て",
  );
});

test("formats an image-only message", () => {
  assert.equal(
    formatDiscordMessage({
      author: user,
      channelId: "channel-123",
      content: "",
      id: "message-456",
      images: [
        {
          data: "c2VjcmV0",
          filename: "sample.png",
          id: "attachment-123",
          mimeType: "image/png",
        },
      ],
    }),
    "(画像のみ)",
  );
});

test("resolves user mentions without changing unrelated numbers", () => {
  assert.equal(
    resolveDiscordMentions(
      "こんにちは <@123456789012345678>。注文番号は123456です。<@!999999999999999999>",
      {
        user: (userId) => (userId === user.id ? user : undefined),
        role: () => undefined,
      },
    ),
    "こんにちは @さつき (@satsuki)。注文番号は123456です。<@!999999999999999999>",
  );
});

test("resolves bot mentions like any other user mention", () => {
  assert.equal(
    resolveDiscordMentions("<@987654321098765432> これを教えて", {
      user: (userId) => (userId === bot.id ? bot : undefined),
      role: () => undefined,
    }),
    "@クライン (@klein) これを教えて",
  );
});

test("resolves role mentions without changing unrelated numbers", () => {
  assert.equal(
    resolveDiscordMentions("<@&111111111111111111> の番号は123456です。<@&999999999999999999>", {
      user: () => undefined,
      role: (roleId) => (roleId === role.id ? role : undefined),
    }),
    "@開発チーム の番号は123456です。<@&999999999999999999>",
  );
});
