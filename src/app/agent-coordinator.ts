import type { Logger } from "pino";

import type { DiscordMessage } from "@modules/discord/domain/discord-message";
import type { DiscordService } from "@modules/discord/ports/discord-service";
import { DiscordAgent } from "@agents/discord/discord-agent";
import type { TaskCoordinator } from "./task-coordinator";

export interface AgentCoordinatorDependencies {
  readonly discordService: DiscordService;
  readonly createDiscordAgent: (channelId: string) => Promise<DiscordAgent>;
  readonly logger: Logger;
  readonly taskCoordinator: TaskCoordinator;
}

export class AgentCoordinator {
  private readonly agents = new Map<string, Promise<DiscordAgent>>();
  private readonly logger: Logger;

  constructor(private readonly dependencies: AgentCoordinatorDependencies) {
    this.logger = dependencies.logger.child({ component: "agent-coordinator" });
  }

  handleDiscordMessage(message: DiscordMessage): Promise<void> {
    return this.dependencies.taskCoordinator.run(() => this.processMessage(message));
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.agents.values()].map(async (agentPromise) => {
        try {
          (await agentPromise).dispose();
        } catch (error) {
          // The agent may fail to finish initialization during shutdown.
          this.logger.warn(
            { err: error, event: "discord_agent_dispose_failed" },
            "Failed to dispose Discord agent",
          );
        }
      }),
    );
  }

  private async processMessage(message: DiscordMessage): Promise<void> {
    const logger = this.logger.child({
      channelId: message.channelId,
      messageId: message.id,
    });
    const startedAt = Date.now();
    logger.debug({ event: "discord_message_processing_started" }, "Processing Discord message");

    try {
      const agent = await this.getDiscordAgent(message.channelId);
      await agent.prompt(message);
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
      await this.dependencies.discordService.sendMessage(
        message.channelId,
        "ごめん、今はうまく返答できないみたい。",
      );
    }
  }

  private getDiscordAgent(channelId: string): Promise<DiscordAgent> {
    const existing = this.agents.get(channelId);
    if (existing) return existing;

    const created = this.dependencies.createDiscordAgent(channelId);
    this.agents.set(channelId, created);
    void created.catch(() => {
      if (this.agents.get(channelId) === created) {
        this.agents.delete(channelId);
      }
    });

    return created;
  }
}
