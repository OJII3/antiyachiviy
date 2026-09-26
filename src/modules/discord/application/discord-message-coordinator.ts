import type { Logger } from "pino";

import type { AgentFactory } from "@agents/core/agent-factory";
import type { AgentRuntime } from "@agents/core/agent-runtime";
import { formatDiscordMessage, type DiscordMessage } from "@modules/discord/domain/discord-message";
import type { DiscordOperatingState } from "@modules/discord/domain/discord-operating-state";
import type { DiscordService } from "@modules/discord/ports/discord-service";
import type { DiscordReplyPolicy } from "@modules/discord/ports/reply-policy";

export interface DiscordMessageCoordinatorDependencies {
  readonly agentFactory: AgentFactory;
  readonly discordService: DiscordService;
  readonly logger: Logger;
  readonly operatingState: DiscordOperatingState;
  readonly replyPolicy: DiscordReplyPolicy;
  readonly systemPrompt: string;
}

export class DiscordMessageCoordinator {
  private readonly agents = new Map<string, Promise<AgentRuntime>>();
  private readonly channelQueues = new Map<string, Promise<void>>();
  private readonly logger: Logger;

  constructor(private readonly dependencies: DiscordMessageCoordinatorDependencies) {
    this.logger = dependencies.logger.child({ component: "discord-message-coordinator" });
  }

  handleDiscordMessage(message: DiscordMessage): Promise<void> {
    if (!this.dependencies.operatingState.isActive()) return Promise.resolve();

    const previous = this.channelQueues.get(message.channelId) ?? Promise.resolve();
    const execution = previous.then(() => this.processMessage(message));
    const settled = execution.then(
      () => undefined,
      () => undefined,
    );
    this.channelQueues.set(message.channelId, settled);
    void settled.then(() => {
      if (this.channelQueues.get(message.channelId) === settled) {
        this.channelQueues.delete(message.channelId);
      }
    });

    return execution;
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.agents.values()].map(async (agentPromise) => {
        try {
          (await agentPromise).dispose();
        } catch (error) {
          this.logger.warn(
            { err: error, event: "character_agent_dispose_failed" },
            "Failed to dispose character agent",
          );
        }
      }),
    );
  }

  private async processMessage(message: DiscordMessage): Promise<void> {
    if (!this.dependencies.operatingState.isActive()) return;

    const logger = this.logger.child({
      channelId: message.channelId,
      messageId: message.id,
    });
    const startedAt = Date.now();
    logger.debug({ event: "discord_message_processing_started" }, "Processing Discord message");

    try {
      if (!(await this.dependencies.replyPolicy.shouldGenerateReply(message))) {
        logger.debug(
          { event: "discord_reply_generation_skipped" },
          "Skipped Discord reply generation",
        );
        return;
      }

      const agent = await this.getAgent(message.channelId);
      const response = await agent.prompt({
        text: formatDiscordMessage(message),
        images: message.images.map(({ data, mimeType }) => ({ data, mimeType })),
      });
      const candidate = response.trim();
      if (!candidate) return;

      if (!(await this.dependencies.replyPolicy.shouldSendReply(message, candidate))) {
        logger.debug({ event: "discord_reply_send_skipped" }, "Discarded generated Discord reply");
        return;
      }

      await this.dependencies.discordService.sendMessage(message.channelId, candidate);
      logger.debug(
        {
          durationMs: Date.now() - startedAt,
          event: "discord_message_processed",
        },
        "Processed Discord message",
      );
    } catch (error) {
      logger.error(
        {
          durationMs: Date.now() - startedAt,
          err: error,
          event: "discord_message_processing_failed",
        },
        "Failed to handle Discord message",
      );
    }
  }

  private getAgent(channelId: string): Promise<AgentRuntime> {
    const existing = this.agents.get(channelId);
    if (existing) return existing;

    const created = this.dependencies.agentFactory.create(
      { systemPrompt: this.dependencies.systemPrompt },
      { sessionKey: `discord-channel:${channelId}` },
    );
    this.agents.set(channelId, created);
    void created.catch(() => {
      if (this.agents.get(channelId) === created) {
        this.agents.delete(channelId);
      }
    });

    return created;
  }
}
