import assert from "node:assert/strict";
import test from "node:test";
import type { Interaction, Message } from "discord.js";

import { createDiscordAccessPolicy } from "../domain/discord-access-policy";
import type { DiscordMessage } from "../domain/discord-message";
import { DiscordOperatingState } from "../domain/discord-operating-state";
import type { DiscordMessageHandler, DiscordSlashCommandHandler } from "../ports/discord-service";
import { DiscordJsService } from "./discord-js-service";

type TestableDiscordJsService = {
  readonly client: {
    user: {
      id: string;
      setActivity?: (...args: unknown[]) => unknown;
      setStatus?: (status: "online" | "idle") => void;
    } | null;
  };
  acceptingMessages: boolean;
  onMessage?: DiscordMessageHandler;
  onSlashCommand?: DiscordSlashCommandHandler;
  handleMessage(message: Message): Promise<void>;
  handleInteraction(interaction: Interaction): Promise<void>;
  synchronizeCommands(readyClient: unknown): Promise<void>;
  startWeeklyUsageRefresh(): void;
  stopWeeklyUsageRefresh(): void;
};

function createMessage(
  options: {
    author?: { bot?: boolean; id?: string };
    content?: string;
    attachments?: Map<string, unknown>;
  } = {},
): Message {
  return {
    author: {
      bot: options.author?.bot ?? false,
      displayName: "さつき",
      id: options.author?.id ?? "user-123",
      username: "satsuki",
    },
    channel: {
      isThread: () => false,
      send: async () => undefined,
    },
    channelId: "channel-123",
    content: options.content ?? "メンションなしのメッセージ",
    guildId: "guild-123",
    id: "message-123",
    attachments: options.attachments ?? new Map(),
    mentions: {
      roles: new Map(),
      users: new Map(),
    },
  } as unknown as Message;
}

function createImageAttachment() {
  return {
    contentType: "image/png",
    id: "attachment-123",
    name: "sample.png",
    size: 68,
    url: "https://cdn.discordapp.com/attachments/sample.png",
  };
}

function createInteraction() {
  const replies: unknown[] = [];
  const interaction = {
    channel: null,
    channelId: "channel-123",
    commandName: "usage",
    deferred: false,
    guildId: "guild-123",
    isChatInputCommand: () => true,
    replied: false,
    reply: async (options: unknown) => {
      replies.push(options);
    },
    followUp: async (options: unknown) => {
      replies.push(options);
    },
    user: {
      displayName: "さつき",
      id: "user-123",
      username: "satsuki",
    },
  } as unknown as Interaction;

  return { interaction, replies };
}

test("forwards guild messages without a bot mention", async () => {
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.client.user = { id: "bot-123" };
  testableService.acceptingMessages = true;

  const received: DiscordMessage[] = [];
  testableService.onMessage = async (message) => {
    received.push(message);
  };

  try {
    await testableService.handleMessage(createMessage());

    assert.equal(received.length, 1);
    assert.equal(received[0]?.content, "メンションなしのメッセージ");
  } finally {
    await service.stop();
  }
});

test("ignores only messages sent by this bot", async () => {
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.client.user = { id: "bot-123" };
  testableService.acceptingMessages = true;

  const received: DiscordMessage[] = [];
  testableService.onMessage = async (message) => {
    received.push(message);
  };

  try {
    await testableService.handleMessage(
      createMessage({ author: { bot: true, id: "bot-123" }, content: "自分の送信メッセージ" }),
    );
    await testableService.handleMessage(
      createMessage({ author: { bot: true, id: "other-bot-456" }, content: "別 bot のメッセージ" }),
    );

    assert.equal(received.length, 1);
    assert.equal(received[0]?.author.bot, true);
    assert.equal(received[0]?.author.id, "other-bot-456");
  } finally {
    await service.stop();
  }
});

test("forwards image attachments, including image-only messages", async () => {
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.client.user = { id: "bot-123" };
  testableService.acceptingMessages = true;

  const received: DiscordMessage[] = [];
  testableService.onMessage = async (message) => {
    received.push(message);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
      { headers: { "content-type": "image/png" } },
    );

  try {
    await testableService.handleMessage(
      createMessage({
        attachments: new Map([["attachment-123", createImageAttachment()]]),
        content: "",
      }),
    );

    assert.equal(received.length, 1);
    assert.equal(received[0]?.content, "");
    assert.deepEqual(
      received[0]?.images.map(({ filename, id, mimeType }) => ({ filename, id, mimeType })),
      [{ filename: "sample.png", id: "attachment-123", mimeType: "image/png" }],
    );
    assert.ok(received[0]?.images[0]?.data);
  } finally {
    globalThis.fetch = originalFetch;
    await service.stop();
  }
});

test("forwards allowed slash commands to the command handler", async () => {
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.acceptingMessages = true;

  const received: string[] = [];
  testableService.onSlashCommand = async (interaction) => {
    received.push(`${interaction.commandName}:${interaction.user.displayName}`);
    await interaction.reply("usage", { ephemeral: true });
  };
  const { interaction, replies } = createInteraction();

  try {
    await testableService.handleInteraction(interaction);

    assert.deepEqual(received, ["usage:さつき"]);
    assert.deepEqual(replies, [{ content: "usage", ephemeral: true }]);
  } finally {
    await service.stop();
  }
});

test("rejects slash commands outside the Discord access policy", async () => {
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "deny", directMessages: "deny" }),
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.acceptingMessages = true;
  testableService.onSlashCommand = async () => {
    throw new Error("The handler must not run");
  };
  const { interaction, replies } = createInteraction();

  try {
    await testableService.handleInteraction(interaction);

    assert.deepEqual(replies, [
      { content: "この場所ではコマンドを利用できません。", ephemeral: true },
    ]);
  } finally {
    await service.stop();
  }
});

test("updates the Discord activity with weekly usage", async () => {
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
    undefined,
    {
      weeklyUsageProvider: {
        getWeeklyUsage: async () => ({ remainingPercentage: 73, resetInDays: 2 }),
      },
      weeklyUsageRefreshIntervalMs: 60_000,
    },
  );
  const testableService = service as unknown as TestableDiscordJsService;
  const activities: string[] = [];
  testableService.client.user = {
    id: "bot-123",
    setActivity: (name: unknown) => {
      activities.push(String(name));
    },
  };

  try {
    testableService.startWeeklyUsageRefresh();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(activities, ["--%/week (reset in -- days)", "73%/week (reset in 2 days)"]);
  } finally {
    testableService.stopWeeklyUsageRefresh();
    await service.stop();
  }
});

test("pauses message handling while the bot is idle", async () => {
  const operatingState = new DiscordOperatingState();
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
    undefined,
    { operatingState },
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.client.user = { id: "bot-123", setStatus: () => undefined };
  testableService.acceptingMessages = true;

  const received: DiscordMessage[] = [];
  testableService.onMessage = async (message) => {
    received.push(message);
  };

  try {
    service.setOperatingMode("paused");
    await testableService.handleMessage(createMessage());

    assert.equal(operatingState.mode, "paused");
    assert.equal(received.length, 0);
  } finally {
    await service.stop();
  }
});

test("changes the Discord presence when the operating mode changes", async () => {
  const operatingState = new DiscordOperatingState();
  const statuses: string[] = [];
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
    undefined,
    { operatingState },
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.client.user = {
    id: "bot-123",
    setStatus: (status) => statuses.push(status),
  };

  try {
    service.setOperatingMode("paused");
    service.setOperatingMode("active");

    assert.deepEqual(statuses, ["idle", "online"]);
    assert.equal(operatingState.mode, "active");
  } finally {
    await service.stop();
  }
});

test("handles idle and online slash commands for members with Manage Server", async () => {
  const operatingState = new DiscordOperatingState();
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
    undefined,
    { operatingState },
  );
  const testableService = service as unknown as TestableDiscordJsService;
  testableService.client.user = {
    id: "bot-123",
    setStatus: () => undefined,
  };
  testableService.acceptingMessages = true;

  const replies: Array<{ content: string; ephemeral: boolean }> = [];
  const interaction = {
    commandName: "idle",
    inGuild: () => true,
    isChatInputCommand: () => true,
    memberPermissions: {
      has: () => true,
    },
    reply: async (response: { content: string; ephemeral: boolean }) => {
      replies.push(response);
    },
  } as unknown as Interaction;

  try {
    await testableService.handleInteraction(interaction);
    assert.equal(operatingState.mode, "paused");
    assert.deepEqual(replies, [{ content: "Botを一時停止しました。", ephemeral: true }]);

    (interaction as { commandName: string }).commandName = "online";
    await testableService.handleInteraction(interaction);
    assert.equal(operatingState.mode, "active");
    assert.deepEqual(replies, [
      { content: "Botを一時停止しました。", ephemeral: true },
      { content: "Botを再開しました。", ephemeral: true },
    ]);
  } finally {
    await service.stop();
  }
});

test("registers the operating mode slash commands", async () => {
  const service = new DiscordJsService(
    "token",
    createDiscordAccessPolicy({ default: "allow", directMessages: "allow" }),
  );
  const testableService = service as unknown as TestableDiscordJsService;
  let registeredCommands: unknown;

  try {
    await testableService.synchronizeCommands({
      application: {
        commands: {
          set: async (commands: unknown) => {
            registeredCommands = commands;
          },
        },
      },
    });

    assert.deepEqual(registeredCommands, [
      {
        name: "idle",
        description: "Botを一時停止します",
        defaultMemberPermissions: 32n,
        dmPermission: false,
      },
      {
        name: "online",
        description: "Botを再開します",
        defaultMemberPermissions: 32n,
        dmPermission: false,
      },
    ]);
  } finally {
    await service.stop();
  }
});
