import { resolve } from "node:path";

import { parseCliOptions } from "./cli-options";
import { loadConfig } from "./config";
import { createLogFilePath, createLogger, flushLogger } from "./logger";
import { loadPromptFile } from "./prompt";
import { TaskCoordinator } from "./task-coordinator";
import { createAntigravityAgentFactory } from "@runtime/antigravity/antigravity-agent-runtime";
import { createAntigravityUsageProvider } from "@modules/discord/infrastructure/antigravity-usage";
import { DiscordMessageCoordinator } from "@modules/discord/application/discord-message-coordinator";
import { JevDiscordReplyPolicy } from "@modules/discord/infrastructure/jev/jev-discord-reply-policy";
import { createDiscordAccessPolicy } from "@modules/discord/domain/discord-access-policy";
import { DiscordOperatingState } from "@modules/discord/domain/discord-operating-state";
import { DiscordJsService } from "@modules/discord/infrastructure/discord-js-service";
import { resolveLogDirectory, resolveWebUiConfig } from "@modules/webui/domain/webui-config";
import { startWebUi } from "@modules/webui/infrastructure/elysia-webui-app";
import { PinoJsonlReader } from "@modules/webui/infrastructure/pino-jsonl-reader";
import { AntigravitySessionReader } from "@modules/webui/infrastructure/antigravity-session-reader";

export async function bootstrap(): Promise<void> {
  const { sessionMode } = parseCliOptions(process.argv.slice(2));
  const config = await loadConfig();
  const logDirectory = resolveLogDirectory(config);
  const logger = createLogger({ filePath: createLogFilePath(logDirectory) });
  logger.info({ event: "application_starting" }, "Starting Yachigravity");

  const systemPrompt = await loadPromptFile(config.agents?.discord?.systemPromptFile);
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is required");
  }
  const discordOperatingState = new DiscordOperatingState();
  const discordService = new DiscordJsService(
    token,
    createDiscordAccessPolicy(config.discord.access),
    logger,
    {
      operatingState: discordOperatingState,
      weeklyUsageProvider: createAntigravityUsageProvider(config.llm.command ?? "agy"),
    },
  );
  const taskCoordinator = new TaskCoordinator();
  const agentDir = resolve(config.runtime.agentDir);
  const characterAgentFactory = createAntigravityAgentFactory({
    agentDir,
    llm: config.llm,
    logger,
    sessionMode,
  });
  const discordMessageCoordinator = new DiscordMessageCoordinator({
    agentFactory: characterAgentFactory,
    discordService,
    logger,
    operatingState: discordOperatingState,
    replyPolicy: new JevDiscordReplyPolicy(),
    systemPrompt,
  });
  const webUiConfig = resolveWebUiConfig(config);
  const webUi = webUiConfig.enabled
    ? await startWebUi({
        host: webUiConfig.host,
        logger,
        antigravitySessions: new AntigravitySessionReader(agentDir),
        pinoLogs: new PinoJsonlReader(logDirectory),
        port: webUiConfig.port,
        staticDirectory: resolve("dist/web"),
      })
    : undefined;

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: "shutdown_started", signal }, "Shutting down");

    await webUi?.stop();
    discordService.stopAccepting();
    await taskCoordinator.waitForCompletion();
    await discordMessageCoordinator.dispose();
    await discordService.stop();
    logger.info({ event: "shutdown_completed" }, "Shutdown complete");
    flushLogger(logger);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await discordService.start((message) =>
    taskCoordinator.run(() => discordMessageCoordinator.handleDiscordMessage(message)),
  );
}

try {
  await bootstrap();
} catch (error) {
  createLogger().fatal({ err: error, event: "bootstrap_failed" }, "Yachigravity failed to start");
  process.exitCode = 1;
}
