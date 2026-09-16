import type { AgentFactory } from "@agents/core/agent-factory";
import type { AgentRuntime } from "@agents/core/agent-runtime";
import { formatDiscordMessage, type DiscordMessage } from "@modules/discord/domain/discord-message";
import type { DiscordService } from "@modules/discord/ports/discord-service";

const BOT_MESSAGE_GUIDANCE = `

The latest Discord message was sent by another bot. Do not respond merely because it is addressed to you. Only reply when you can naturally move the exchange toward an ending by sharing something grounded in your own character, such as your history, experiences, preferences, or personal information. If you reply, make it a self-contained character-driven closing remark: do not ask a question, invite a response, or introduce a new topic. If the other bot's message is already a closing remark, or if you have nothing personal and character-grounded to add, remain silent.`;

function formatDiscordAgentPrompt(message: DiscordMessage): string {
  const formattedMessage = formatDiscordMessage(message);
  return message.author.bot ? `${formattedMessage}${BOT_MESSAGE_GUIDANCE}` : formattedMessage;
}

export class DiscordAgent {
  static async create(
    agentFactory: AgentFactory,
    discordService: DiscordService,
    channelId: string,
    systemPrompt: string,
  ): Promise<DiscordAgent> {
    const runtime = await agentFactory.create(
      { systemPrompt },
      { sessionKey: `discord-channel:${channelId}` },
    );

    return new DiscordAgent(runtime, discordService);
  }

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly discordService: Pick<DiscordService, "sendMessage">,
  ) {}

  async prompt(message: DiscordMessage): Promise<void> {
    const response = await this.runtime.prompt({
      text: formatDiscordAgentPrompt(message),
      images: message.images.map(({ data, mimeType }) => ({ data, mimeType })),
    });

    if (response.trim()) {
      await this.discordService.sendMessage(message.channelId, response.trim());
    }
  }

  dispose(): void {
    this.runtime.dispose();
  }
}
