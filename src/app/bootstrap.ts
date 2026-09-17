import { resolve } from "node:path";

import { AgentCoordinator } from "./agent-coordinator";
import { parseCliOptions } from "./cli-options";
import { loadConfig } from "./config";
import { createLogFilePath, createLogger, flushLogger } from "./logger";
import { loadPromptFile } from "./prompt";
import { TaskCoordinator } from "./task-coordinator";
import { DiscordAgent } from "@agents/discord/discord-agent";
import { createAntigravityAgentFactory } from "@runtime/antigravity/antigravity-agent-runtime";
import { createPythonAntigravityAgentFactory } from "@runtime/antigravity/python-agent-runtime";
import { DiscordSendMcpGateway } from "@runtime/antigravity/discord-send-mcp-gateway";
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
    { antigravityCommand: config.llm.command, operatingState: discordOperatingState },
  );
  const discordSendGateway = new DiscordSendMcpGateway(discordService, logger);
  await discordSendGateway.start();
  const taskCoordinator = new TaskCoordinator();
  const agentDir = resolve(config.runtime.agentDir);
  const antigravityAgentFactory =
    config.llm.backend === "cli"
      ? createAntigravityAgentFactory({
          agentDir,
          discordSendGateway,
          llm: config.llm,
          logger,
          sessionMode,
        })
      : createPythonAntigravityAgentFactory({
          agentDir,
          discordSendGateway,
          llm: config.llm,
          logger,
          sessionMode,
        });
  const agentCoordinator = new AgentCoordinator({
    createDiscordAgent: (channelId) =>
      DiscordAgent.create(antigravityAgentFactory, discordService, channelId, systemPrompt),
    discordService,
    logger,
    operatingState: discordOperatingState,
    taskCoordinator,
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
    await agentCoordinator.dispose();
    await discordSendGateway.stop();
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

  await discordService.start((message) => agentCoordinator.handleDiscordMessage(message));
}

try {
  await bootstrap();
} catch (error) {
  createLogger().fatal({ err: error, event: "bootstrap_failed" }, "Yachigravity failed to start");
  process.exitCode = 1;
}
