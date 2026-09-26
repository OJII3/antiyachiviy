import type { DiscordMessage } from "../domain/discord-message";

export interface DiscordReplyPolicy {
  shouldGenerateReply(message: DiscordMessage): Promise<boolean>;
  shouldSendReply(message: DiscordMessage, response: string): Promise<boolean>;
}
