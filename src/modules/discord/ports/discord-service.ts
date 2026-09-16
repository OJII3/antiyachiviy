import type { DiscordMessage, DiscordMessageLocator, DiscordUser } from "../domain/discord-message";

export interface DiscordSlashCommandDefinition {
  readonly name: string;
  readonly description: string;
}

export interface DiscordSlashCommandReplyOptions {
  readonly ephemeral?: boolean;
}

export interface DiscordSlashCommandContext {
  readonly channelId?: string;
  readonly commandName: string;
  readonly guildId?: string;
  readonly user: DiscordUser;
  deferReply(options?: DiscordSlashCommandReplyOptions): Promise<void>;
  editReply(content: string): Promise<void>;
  reply(content: string, options?: DiscordSlashCommandReplyOptions): Promise<void>;
}

export type DiscordSlashCommandHandler = (interaction: DiscordSlashCommandContext) => Promise<void>;

export type DiscordMessageHandler = (message: DiscordMessage) => Promise<void>;

export interface DiscordService {
  start(
    onMessage: DiscordMessageHandler,
    onSlashCommand?: DiscordSlashCommandHandler,
  ): Promise<void>;
  stopAccepting(): void;
  sendMessage(channelId: string, content: string): Promise<void>;
  readMessage(locator: DiscordMessageLocator): Promise<DiscordMessage>;
  stop(): Promise<void>;
}
