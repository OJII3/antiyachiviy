import { resolve } from "node:path";

import { staticPlugin } from "@elysia/static";
import { Elysia } from "elysia";
import type { Logger } from "pino";

import { LogsQuerySchema, SessionParamsSchema } from "../domain/api-schema";
import type { PinoLogQuery } from "./pino-jsonl-reader";
import { PinoJsonlReader } from "./pino-jsonl-reader";
import { AntigravitySessionReader } from "./antigravity-session-reader";

const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);

export interface WebUiDependencies {
  readonly pinoLogs: PinoJsonlReader;
  readonly antigravitySessions: AntigravitySessionReader;
  readonly logger?: Logger;
}

export interface WebUiServerOptions extends WebUiDependencies {
  readonly host: string;
  readonly port: number;
  readonly staticDirectory: string;
}

export interface WebUiServer {
  readonly stop: () => Promise<void>;
}

export function createWebUiApp(dependencies: WebUiDependencies) {
  return new Elysia({ name: "yachigravity-webui" })
    .get("/api/health", () => ({ ok: true }))
    .get(
      "/api/logs",
      async ({ query, set }) => {
        try {
          const logQuery: PinoLogQuery = {
            channelId: query.channelId,
            cursor: query.cursor,
            event: query.event,
            level: query.level,
            limit: parseLimit(query.limit),
            q: query.q,
          };
          validateLogQuery(logQuery);
          return await dependencies.pinoLogs.list(logQuery);
        } catch (error) {
          return handleRouteError(set, dependencies.logger, error, "Failed to list pino logs");
        }
      },
      { query: LogsQuerySchema },
    )
    .get("/api/sessions", async ({ set }) => {
      try {
        return { items: await dependencies.antigravitySessions.list() };
      } catch (error) {
        return handleRouteError(
          set,
          dependencies.logger,
          error,
          "Failed to list Antigravity sessions",
        );
      }
    })
    .get(
      "/api/sessions/:sessionId",
      async ({ params, set }) => {
        try {
          const detail = await dependencies.antigravitySessions.get(params.sessionId);
          if (!detail) {
            set.status = 404;
            return { error: "Session not found" };
          }
          return detail;
        } catch (error) {
          return handleRouteError(
            set,
            dependencies.logger,
            error,
            "Failed to read Antigravity session",
          );
        }
      },
      { params: SessionParamsSchema },
    );
}

export type WebUiApp = ReturnType<typeof createWebUiApp>;

export async function startWebUi(options: WebUiServerOptions): Promise<WebUiServer> {
  const staticApp = await staticPlugin({
    assets: resolve(options.staticDirectory),
    alwaysStatic: true,
    bunFullstack: false,
    indexHTML: true,
    prefix: "/",
  });
  const app = createWebUiApp(options).use(staticApp);

  app.listen({ hostname: options.host, port: options.port });
  options.logger?.info(
    {
      event: "webui_started",
      host: options.host,
      port: options.port,
    },
    "Web UI started",
  );

  return {
    stop: async () => {
      await app.stop();
      options.logger?.info({ event: "webui_stopped" }, "Web UI stopped");
    },
  };
}

function validateLogQuery(query: PinoLogQuery): void {
  if (query.level && !LOG_LEVELS.has(query.level) && !/^\d+$/.test(query.level)) {
    throw new WebUiRequestError(`Unknown log level: ${query.level}`);
  }
}

function parseLimit(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new WebUiRequestError("Log limit must be an integer between 1 and 200");
  }
  return limit;
}

function handleRouteError(
  set: { status?: number | string },
  logger: Logger | undefined,
  error: unknown,
  message: string,
): { error: string } {
  if (error instanceof WebUiRequestError || isClientError(error)) {
    set.status = 400;
    return { error: error instanceof Error ? error.message : String(error) };
  }

  logger?.error({ err: error, event: "webui_request_failed" }, message);
  set.status = 500;
  return { error: "Internal server error" };
}

function isClientError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message.startsWith("Invalid log cursor") ||
      error.message.startsWith("Unknown log cursor") ||
      error.message.startsWith("Log limit"))
  );
}

class WebUiRequestError extends Error {}
