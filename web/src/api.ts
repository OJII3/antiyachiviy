import { treaty } from "@elysia/eden";

import type { WebUiApp } from "@modules/webui/infrastructure/elysia-webui-app";

export interface PinoLog {
  source: "pino";
  id: string;
  timestamp: string;
  level: number | string;
  kind: string;
  summary: string;
  attributes: Record<string, unknown>;
}

export interface LogsResponse {
  items: PinoLog[];
  nextCursor: string | null;
}

export interface LogsQuery {
  limit?: number;
  cursor?: string;
  level?: string;
  q?: string;
  channelId?: string;
  event?: string;
}

export interface SessionSummary {
  id: string;
  channelKey: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
}

export interface SessionsResponse {
  items: SessionSummary[];
}

export interface AntigravitySessionEvent {
  source: "antigravity";
  id: string;
  timestamp: string;
  sessionId: string;
  kind: string;
  role?: string;
  parentId?: string | null;
  content?: unknown;
}

export interface SessionDetailResponse {
  session: SessionSummary;
  items: AntigravitySessionEvent[];
}

const apiOrigin = typeof window === "undefined" ? "http://127.0.0.1:4310" : window.location.origin;

const client = treaty<WebUiApp>(apiOrigin);

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("value" in error) {
      const value = errorMessage(error.value);
      if (value !== "APIリクエストに失敗しました") return value;
    }
    if ("error" in error) {
      const value = errorMessage(error.error);
      if (value !== "APIリクエストに失敗しました") return value;
    }
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "APIリクエストに失敗しました";
}

async function unwrap<T>(request: Promise<unknown>): Promise<T> {
  const response = (await request) as { data?: unknown; error?: unknown };
  if (response.error) throw new Error(errorMessage(response.error));
  if (response.data === undefined) throw new Error("APIレスポンスが空です");
  return response.data as T;
}

function withoutEmptyValues(query: LogsQuery): Partial<LogsQuery> {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ""),
  ) as Partial<LogsQuery>;
}

export function listLogs(query: LogsQuery = {}): Promise<LogsResponse> {
  return unwrap<LogsResponse>(
    client.api.logs.get({ query: withoutEmptyValues({ limit: 100, ...query }) }),
  );
}

export function listSessions(): Promise<SessionsResponse> {
  return unwrap<SessionsResponse>(client.api.sessions.get());
}

export function getSession(sessionId: string): Promise<SessionDetailResponse> {
  return unwrap<SessionDetailResponse>(client.api.sessions({ sessionId }).get());
}
