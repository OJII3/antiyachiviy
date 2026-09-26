export interface DiscordUser {
  readonly bot: boolean;
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface DiscordRole {
  readonly id: string;
  readonly name: string;
}

export interface DiscordReplyReference {
  readonly id: string;
  readonly author?: DiscordUser;
  readonly content?: string;
}

export interface DiscordImageAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly data: string;
}

export interface DiscordMessage {
  readonly channelId: string;
  readonly guildId?: string;
  readonly parentChannelId?: string;
  readonly threadId?: string;
  readonly author: DiscordUser;
  readonly content: string;
  readonly mentionsYachiyo: boolean;
  readonly id: string;
  readonly images: readonly DiscordImageAttachment[];
  readonly replyTo?: DiscordReplyReference;
}

export interface DiscordMessageLocator {
  readonly channelId: string;
  readonly messageId: string;
}

export function formatDiscordUser(user: DiscordUser): string {
  if (user.displayName === user.username) return user.displayName;

  return `${user.displayName} (@${user.username})`;
}

export function formatDiscordMessage(message: DiscordMessage): string {
  const replyContent = message.replyTo?.content?.trim();
  const replyContext = replyContent ? `返信先のメッセージ:\n${replyContent}\n\n` : "";
  const content = message.content || (message.images.length > 0 ? "(画像のみ)" : "");

  return `${replyContext}${content}`;
}

export function resolveDiscordMentions(
  content: string,
  resolvers: {
    readonly user: (userId: string) => DiscordUser | undefined;
    readonly role: (roleId: string) => DiscordRole | undefined;
  },
): string {
  return content.replace(/<@([!&]?)(\d+)>/g, (mention, kind: string, id: string) => {
    if (kind === "&") {
      const role = resolvers.role(id);
      return role ? `@${role.name}` : mention;
    }

    const user = resolvers.user(id);
    return user ? `@${formatDiscordUser(user)}` : mention;
  });
}
