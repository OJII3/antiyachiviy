import {
  Client,
  ActivityType,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  type Attachment,
  type ApplicationCommandDataResolvable,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
} from "discord.js";
import type { Logger } from "pino";

import type { DiscordAccessPolicy } from "../domain/discord-access-policy";
import {
  DiscordOperatingState,
  type DiscordOperatingMode,
} from "../domain/discord-operating-state";
import {
  resolveDiscordMentions,
  type DiscordImageAttachment,
  type DiscordMessage,
  type DiscordMessageLocator,
  type DiscordReplyReference,
  type DiscordUser,
} from "../domain/discord-message";
import type {
  DiscordMessageHandler,
  DiscordService,
  DiscordSlashCommandHandler,
} from "../ports/discord-service";
import { formatWeeklyUsageActivity, type WeeklyUsage } from "../domain/weekly-usage";
import type { WeeklyUsageProvider } from "../ports/weekly-usage-provider";

const DISCORD_MESSAGE_LIMIT = 2_000;
const DISCORD_IMAGE_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const DISCORD_IMAGE_FETCH_TIMEOUT_MS = 15_000;
const DISCORD_IMAGE_MIME_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const DEFAULT_WEEKLY_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;
const OPERATING_MODE_COMMANDS: readonly ApplicationCommandDataResolvable[] = [
  {
    name: "idle",
    description: "Botを一時停止します",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    dmPermission: false,
  },
  {
    name: "online",
    description: "Botを再開します",
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
    dmPermission: false,
  },
];

export interface DiscordJsServiceOptions {
  readonly operatingState?: DiscordOperatingState;
  readonly weeklyUsageProvider?: WeeklyUsageProvider;
  readonly weeklyUsageRefreshIntervalMs?: number;
}

interface SendableChannel {
  send(content: string): Promise<unknown>;
}

function isSendableChannel(value: unknown): value is SendableChannel {
  return (
    typeof value === "object" &&
    value !== null &&
    "send" in value &&
    typeof value.send === "function"
  );
}

function splitMessage(content: string): string[] {
  const chunks: string[] = [];

  for (let offset = 0; offset < content.length; offset += DISCORD_MESSAGE_LIMIT) {
    chunks.push(content.slice(offset, offset + DISCORD_MESSAGE_LIMIT));
  }

  return chunks;
}

function normalizeImageMimeType(contentType: string | null): string | undefined {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  if (!normalizedMimeType || !DISCORD_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
    return undefined;
  }

  return normalizedMimeType;
}

function hasSupportedImageAttachment(message: Message): boolean {
  return [...message.attachments.values()].some(
    (attachment) => normalizeImageMimeType(attachment.contentType) !== undefined,
  );
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > DISCORD_IMAGE_MAX_DOWNLOAD_BYTES) {
    throw new Error("Discord image attachment exceeds the download size limit");
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > DISCORD_IMAGE_MAX_DOWNLOAD_BYTES) {
      throw new Error("Discord image attachment exceeds the download size limit");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > DISCORD_IMAGE_MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error("Discord image attachment exceeds the download size limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function toDiscordUser(message: Message): DiscordUser {
  return {
    bot: message.author.bot,
    id: message.author.id,
    username: message.author.username,
    displayName: message.member?.displayName ?? message.author.displayName,
  };
}

function toDiscordInteractionUser(interaction: ChatInputCommandInteraction): DiscordUser {
  return {
    bot: interaction.user.bot,
    id: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.user.displayName,
  };
}

export class DiscordJsService implements DiscordService {
  private readonly client: Client;
  private readonly channels = new Map<string, SendableChannel>();
  private onMessage?: DiscordMessageHandler;
  private onSlashCommand?: DiscordSlashCommandHandler;
  private interactionListener?: (interaction: Interaction) => void;
  private messageListener?: (message: Message) => void;
  private acceptingMessages = false;
  private readonly logger?: Logger;
  private readonly weeklyUsageProvider?: WeeklyUsageProvider;
  private readonly weeklyUsageRefreshIntervalMs: number;
  private readonly operatingState: DiscordOperatingState;
  private weeklyUsageRefreshTimer?: ReturnType<typeof setInterval>;
  private weeklyUsageRefreshInFlight?: Promise<void>;
  private weeklyUsageRefreshEnabled = false;

  constructor(
    private readonly token: string,
    private readonly accessPolicy: DiscordAccessPolicy,
    logger?: Logger,
    options: DiscordJsServiceOptions = {},
  ) {
    this.logger = logger?.child({ component: "discord-service" });
    this.weeklyUsageProvider = options.weeklyUsageProvider;
    this.weeklyUsageRefreshIntervalMs =
      options.weeklyUsageRefreshIntervalMs ?? DEFAULT_WEEKLY_USAGE_REFRESH_INTERVAL_MS;
    this.operatingState = options.operatingState ?? new DiscordOperatingState();
    this.client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }

  async start(
    onMessage: DiscordMessageHandler,
    onSlashCommand?: DiscordSlashCommandHandler,
  ): Promise<void> {
    this.onMessage = onMessage;
    this.onSlashCommand = onSlashCommand;
    this.acceptingMessages = true;
    this.client.once(Events.ClientReady, (readyClient) => {
      this.applyOperatingModePresence();
      this.logger?.info(
        {
          event: "discord_client_ready",
          userId: readyClient.user.id,
        },
        "Discord client is ready",
      );
      this.startWeeklyUsageRefresh();
      void this.synchronizeCommands(readyClient)
        .then(() => {
          this.logger?.info(
            { event: "discord_commands_synchronized" },
            "Synchronized Discord commands",
          );
        })
        .catch((error: unknown) => {
          this.logger?.error(
            { err: error, event: "discord_commands_synchronization_failed" },
            "Failed to synchronize Discord commands",
          );
        });
    });
    this.messageListener = (message) => {
      void this.handleMessage(message).catch((error: unknown) => {
        this.logger?.error(
          { err: error, event: "discord_message_handler_failed" },
          "Failed to handle Discord message",
        );
      });
    };
    this.client.on(Events.MessageCreate, this.messageListener);
    this.interactionListener = (interaction) => {
      void this.handleInteraction(interaction).catch((error: unknown) => {
        this.logger?.error(
          { err: error, event: "discord_interaction_handler_failed" },
          "Failed to handle Discord interaction",
        );
      });
    };
    this.client.on(Events.InteractionCreate, this.interactionListener);

    await this.client.login(this.token);
  }

  async sendMessage(channelId: string, content: string): Promise<void> {
    const channel = await this.getChannel(channelId);

    for (const chunk of splitMessage(content)) {
      await channel.send(chunk);
    }
  }

  setOperatingMode(mode: DiscordOperatingMode): void {
    this.operatingState.setMode(mode);
    this.applyOperatingModePresence();
    this.logger?.info(
      { event: "discord_operating_mode_changed", mode },
      "Changed Discord operating mode",
    );
  }

  async readMessage(locator: DiscordMessageLocator): Promise<DiscordMessage> {
    const channel = await this.client.channels.fetch(locator.channelId);
    if (!channel?.isTextBased()) {
      throw new Error(`Discord channel cannot contain messages: ${locator.channelId}`);
    }

    const message = await channel.messages.fetch(locator.messageId);
    const normalizedMessage = this.toDiscordMessage(message);
    const [images, replyTo] = await Promise.all([
      this.fetchImages(message),
      this.fetchReplyReference(message),
    ]);

    return {
      ...normalizedMessage,
      images,
      replyTo,
    };
  }

  stopAccepting(): void {
    this.acceptingMessages = false;

    if (this.messageListener) {
      this.client.off(Events.MessageCreate, this.messageListener);
      this.messageListener = undefined;
    }

    if (this.interactionListener) {
      this.client.off(Events.InteractionCreate, this.interactionListener);
      this.interactionListener = undefined;
    }
  }

  async stop(): Promise<void> {
    this.onMessage = undefined;
    this.onSlashCommand = undefined;
    this.stopAccepting();
    this.stopWeeklyUsageRefresh();
    this.channels.clear();
    this.client.destroy();
  }

  private async getChannel(channelId: string): Promise<SendableChannel> {
    const cachedChannel = this.channels.get(channelId);
    if (cachedChannel) return cachedChannel;

    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableChannel(channel)) {
      throw new Error(`Discord channel is not sendable: ${channelId}`);
    }

    this.channels.set(channelId, channel);
    return channel;
  }

  private startWeeklyUsageRefresh(): void {
    this.stopWeeklyUsageRefresh();
    this.weeklyUsageRefreshEnabled = true;
    this.setWeeklyUsageActivity(undefined);
    if (!this.weeklyUsageProvider) return;

    void this.refreshWeeklyUsage();
    this.weeklyUsageRefreshTimer = setInterval(() => {
      void this.refreshWeeklyUsage();
    }, this.weeklyUsageRefreshIntervalMs);
  }

  private stopWeeklyUsageRefresh(): void {
    this.weeklyUsageRefreshEnabled = false;
    if (this.weeklyUsageRefreshTimer) {
      clearInterval(this.weeklyUsageRefreshTimer);
      this.weeklyUsageRefreshTimer = undefined;
    }
  }

  private refreshWeeklyUsage(): Promise<void> {
    const provider = this.weeklyUsageProvider;
    if (!provider) return Promise.resolve();
    if (this.weeklyUsageRefreshInFlight) return this.weeklyUsageRefreshInFlight;

    const refresh = provider
      .getWeeklyUsage()
      .then((usage) => {
        if (this.weeklyUsageRefreshEnabled) this.setWeeklyUsageActivity(usage);
      })
      .catch((error: unknown) => {
        this.logger?.warn(
          { err: error, event: "discord_weekly_usage_refresh_failed" },
          "Failed to refresh Discord weekly usage activity",
        );
      });
    this.weeklyUsageRefreshInFlight = refresh;
    void refresh.finally(() => {
      if (this.weeklyUsageRefreshInFlight === refresh) {
        this.weeklyUsageRefreshInFlight = undefined;
      }
    });
    return refresh;
  }

  private setWeeklyUsageActivity(usage: WeeklyUsage | undefined): void {
    this.client.user?.setActivity(formatWeeklyUsageActivity(usage), {
      type: ActivityType.Watching,
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    if (!this.canAcceptMessages()) return;
    if (message.author.id === this.client.user?.id) return;

    const content = message.content.trim();
    if (!content && !hasSupportedImageAttachment(message)) return;
    if (!isSendableChannel(message.channel)) return;

    this.channels.set(message.channelId, message.channel);

    const normalizedMessage = this.toDiscordMessage(message);

    if (!this.canAcceptMessages()) return;

    if (
      !this.accessPolicy.canReceive({
        guildId: normalizedMessage.guildId,
        channelId: normalizedMessage.parentChannelId ?? normalizedMessage.channelId,
        threadId: normalizedMessage.threadId,
      })
    ) {
      return;
    }

    if (!this.canAcceptMessages()) return;

    const [images, replyTo] = await Promise.all([
      this.fetchImages(message),
      this.fetchReplyReference(message),
    ]);

    if (!this.canAcceptMessages()) return;
    if (!content && images.length === 0) return;

    await this.onMessage?.({
      ...normalizedMessage,
      images,
      replyTo,
    });
  }

  private canAcceptMessages(): boolean {
    return this.acceptingMessages && this.operatingState.isActive();
  }

  private applyOperatingModePresence(): void {
    if (!this.client.user) return;

    this.client.user.setStatus(this.operatingState.isActive() ? "online" : "idle");
  }

  private async synchronizeCommands(readyClient: Client<true>): Promise<void> {
    await readyClient.application.commands.set(OPERATING_MODE_COMMANDS);
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!this.acceptingMessages || !interaction.isChatInputCommand()) return;

    const mode =
      interaction.commandName === "idle"
        ? ("paused" as const)
        : interaction.commandName === "online"
          ? ("active" as const)
          : undefined;
    if (mode) {
      await this.handleOperatingModeInteraction(interaction, mode);
      return;
    }

    const channelId = interaction.channelId;
    if (!channelId) {
      await this.replyToInteraction(interaction, "この場所ではコマンドを利用できません。", true);
      return;
    }

    const channel = interaction.channel;
    const thread = channel?.isThread() ? channel : undefined;
    const canReceive = this.accessPolicy.canReceive({
      channelId: thread?.parentId ?? channelId,
      guildId: interaction.guildId ?? undefined,
      threadId: thread?.id,
    });
    if (!canReceive) {
      await this.replyToInteraction(interaction, "この場所ではコマンドを利用できません。", true);
      return;
    }

    const handler = this.onSlashCommand;
    if (!handler) return;

    try {
      await handler({
        channelId,
        commandName: interaction.commandName,
        deferReply: async (options) => {
          await interaction.deferReply({ ephemeral: options?.ephemeral ?? false });
        },
        editReply: async (content) => {
          await interaction.editReply({ content });
        },
        guildId: interaction.guildId ?? undefined,
        reply: (content, options) =>
          this.replyToInteraction(interaction, content, options?.ephemeral ?? false),
        user: toDiscordInteractionUser(interaction),
      });
    } catch (error) {
      this.logger?.error(
        {
          commandName: interaction.commandName,
          err: error,
          event: "discord_slash_command_handler_failed",
        },
        "Failed to handle Discord slash command",
      );

      try {
        await this.replyToInteraction(
          interaction,
          "ごめん、コマンドを処理できませんでした。",
          true,
        );
      } catch (replyError) {
        this.logger?.error(
          {
            commandName: interaction.commandName,
            err: replyError,
            event: "discord_slash_command_error_reply_failed",
          },
          "Failed to reply to Discord slash command error",
        );
      }
    }
  }

  private async handleOperatingModeInteraction(
    interaction: ChatInputCommandInteraction,
    mode: DiscordOperatingMode,
  ): Promise<void> {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: "このコマンドはサーバー内でのみ使用できます。",
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "このコマンドを実行する権限がありません。",
        ephemeral: true,
      });
      return;
    }

    this.setOperatingMode(mode);
    await interaction.reply({
      content: mode === "active" ? "Botを再開しました。" : "Botを一時停止しました。",
      ephemeral: true,
    });
  }

  private async replyToInteraction(
    interaction: ChatInputCommandInteraction,
    content: string,
    ephemeral: boolean,
  ): Promise<void> {
    const options = { content, ephemeral };
    if (interaction.deferred) {
      await interaction.editReply({ content });
    } else if (interaction.replied) {
      await interaction.followUp(options);
    } else {
      await interaction.reply(options);
    }
  }

  private toDiscordMessage(message: Message): DiscordMessage {
    const thread = message.channel.isThread() ? message.channel : undefined;

    return {
      author: toDiscordUser(message),
      channelId: message.channelId,
      content: this.normalizeMessageContent(message),
      guildId: message.guildId ?? undefined,
      id: message.id,
      images: [],
      mentionsYachiyo: this.client.user
        ? message.mentions.users.has(this.client.user.id)
        : false,
      parentChannelId: thread?.parentId ?? undefined,
      threadId: thread?.id,
    };
  }

  private async fetchImages(message: Message): Promise<DiscordImageAttachment[]> {
    const imageAttachments = [...message.attachments.values()].filter(
      (attachment) => normalizeImageMimeType(attachment.contentType) !== undefined,
    );

    const images = await Promise.all(
      imageAttachments.map(async (attachment) => {
        try {
          return await this.fetchImage(attachment);
        } catch (error) {
          this.logger?.warn(
            {
              attachmentId: attachment.id,
              err: error,
              event: "discord_image_attachment_fetch_failed",
              messageId: message.id,
            },
            "Failed to fetch Discord image attachment",
          );
          return undefined;
        }
      }),
    );

    return images.filter((image): image is DiscordImageAttachment => image !== undefined);
  }

  private async fetchImage(attachment: Attachment): Promise<DiscordImageAttachment> {
    const mimeType = normalizeImageMimeType(attachment.contentType);
    if (!mimeType) {
      throw new Error(`Unsupported Discord image type: ${attachment.contentType ?? "unknown"}`);
    }
    if (attachment.size > DISCORD_IMAGE_MAX_DOWNLOAD_BYTES) {
      throw new Error("Discord image attachment exceeds the download size limit");
    }

    const response = await fetch(attachment.url, {
      signal: AbortSignal.timeout(DISCORD_IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Discord image attachment returned HTTP ${response.status}`);
    }

    return {
      data: Buffer.from(await readResponseBytes(response)).toString("base64"),
      filename: attachment.name,
      id: attachment.id,
      mimeType,
    };
  }

  private normalizeMessageContent(message: Message): string {
    const content = message.content.trim();

    return resolveDiscordMentions(content, {
      user: (userId) => {
        const user = message.mentions.users.get(userId);
        if (!user) return undefined;

        return {
          bot: user.bot,
          id: user.id,
          username: user.username,
          displayName: message.mentions.members?.get(userId)?.displayName ?? user.displayName,
        };
      },
      role: (roleId) => {
        const role = message.mentions.roles.get(roleId);
        return role ? { id: role.id, name: role.name } : undefined;
      },
    });
  }

  private async fetchReplyReference(message: Message): Promise<DiscordReplyReference | undefined> {
    const messageId = message.reference?.messageId;
    if (!messageId) return undefined;

    try {
      const referencedMessage = await message.fetchReference();
      return {
        author: toDiscordUser(referencedMessage),
        content: this.normalizeMessageContent(referencedMessage),
        id: referencedMessage.id,
      };
    } catch (error) {
      this.logger?.warn(
        {
          err: error,
          event: "discord_reply_reference_fetch_failed",
          messageId,
        },
        "Failed to fetch Discord reply reference",
      );
      return { id: messageId };
    }
  }
}
