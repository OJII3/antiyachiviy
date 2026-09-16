import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type AntigravitySession,
  type AntigravitySessionEvent,
  readSession,
} from "@runtime/antigravity/session-store";
import type {
  AntigravityViewerEvent,
  ViewerSessionDetail,
  ViewerSessionSummary,
} from "../domain/viewer-event";

const FIRST_MESSAGE_MAX_LENGTH = 240;
const EVENT_SUMMARY_MAX_LENGTH = 500;

export class AntigravitySessionReader {
  constructor(private readonly agentDirectory: string) {}

  async list(): Promise<ViewerSessionSummary[]> {
    const directories = await this.listSessionDirectories();
    const sessions = (
      await Promise.all(
        directories.map(async ({ channelKey, directory }) => {
          const paths = await this.listFiles(directory);
          return Promise.all(
            paths.map(async (path) => {
              const session = await readSession(path);
              return session ? toSessionSummary(session, channelKey) : undefined;
            }),
          );
        }),
      )
    )
      .flat()
      .filter((session): session is ViewerSessionSummary => session !== undefined);

    return sessions.sort((left, right) => right.modified.localeCompare(left.modified));
  }

  async get(sessionId: string): Promise<ViewerSessionDetail | undefined> {
    const found = await this.findSession(sessionId);
    if (!found) return undefined;

    return {
      session: toSessionSummary(found.session, found.channelKey),
      items: found.session.events.map((event) => toViewerEvent(event, sessionId)),
    };
  }

  private async findSession(
    sessionId: string,
  ): Promise<{ readonly channelKey: string; readonly session: AntigravitySession } | undefined> {
    const directories = await this.listSessionDirectories();
    for (const { channelKey, directory } of directories) {
      for (const path of await this.listFiles(directory)) {
        const session = await readSession(path);
        if (session?.id === sessionId) return { channelKey, session };
      }
    }
    return undefined;
  }

  private async listSessionDirectories(): Promise<
    { readonly channelKey: string; readonly directory: string }[]
  > {
    const sessionsDirectory = resolve(this.agentDirectory, "sessions");
    let entries;
    try {
      entries = await readdir(sessionsDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    return entries.flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const channelKey = decodeChannelKey(entry.name);
      return channelKey === undefined
        ? []
        : [{ channelKey, directory: resolve(sessionsDirectory, entry.name) }];
    });
  }

  private async listFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => resolve(directory, entry.name));
  }
}

function toSessionSummary(session: AntigravitySession, channelKey: string): ViewerSessionSummary {
  const firstMessage = session.events.find((event) => event.kind === "user")?.summary ?? "";
  const messageCount = session.events.filter(
    (event) => event.kind === "user" || event.kind === "assistant",
  ).length;
  return {
    id: session.id,
    channelKey,
    created: session.created,
    modified: session.modified,
    messageCount,
    firstMessage: truncate(firstMessage, FIRST_MESSAGE_MAX_LENGTH),
  };
}

function toViewerEvent(event: AntigravitySessionEvent, sessionId: string): AntigravityViewerEvent {
  return {
    source: "antigravity",
    id: event.id,
    timestamp: event.timestamp,
    sessionId,
    kind: event.kind,
    role: event.role,
    summary: truncate(event.summary, EVENT_SUMMARY_MAX_LENGTH),
    content: sanitizeContent(event.content),
  };
}

function sanitizeContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeContent);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizeContent(nested)]),
  );
}

function decodeChannelKey(directoryName: string): string | undefined {
  try {
    return decodeURIComponent(directoryName);
  } catch {
    return undefined;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
