import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDiscordMessage,
  formatDiscordReply,
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

test("formats a Discord message with its reply context", () => {
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
    "↪ クライン: 返信元 ⟦message-123⟧\nさつき (@satsuki):\n本文です",
  );
});

test("does not duplicate a username used as the display name", () => {
  assert.equal(formatDiscordUser({ ...user, displayName: user.username }), "satsuki");
});

test("formats a reply reference with a display name and message id", () => {
  assert.equal(
    formatDiscordReply({
      author: user,
      content: "元のメッセージ\nの本文",
      id: "message-123",
    }),
    "↪ さつき: 元のメッセージ の本文 ⟦message-123⟧",
  );
});

test("truncates a reply reference preview", () => {
  const content = "あ".repeat(257);

  assert.equal(
    formatDiscordReply({ content, id: "message-123" }),
    `↪ 不明なユーザー: ${"あ".repeat(256)}… ⟦message-123⟧`,
  );
});

test("formats image attachment context without including image data", () => {
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
    "さつき (@satsuki):\nこれを見て\n[添付画像: sample.png]",
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
    "さつき (@satsuki):\n(画像のみ)\n[添付画像: sample.png]",
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
