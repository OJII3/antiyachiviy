import type { AgentFactory } from "@agents/core/agent-factory";
import type { AgentRuntime } from "@agents/core/agent-runtime";
import { formatDiscordMessage, type DiscordMessage } from "@modules/discord/domain/discord-message";
import type { DiscordService } from "@modules/discord/ports/discord-service";

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
      text: formatDiscordMessage(message),
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
