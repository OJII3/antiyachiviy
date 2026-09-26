import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

export interface AntigravitySessionEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly kind: "user" | "assistant" | "tool" | "status";
  readonly role?: "user" | "assistant";
  readonly summary: string;
  readonly content?: unknown;
}

type AntigravitySessionBackend = "cli" | "python-sdk";

export interface AntigravitySession {
  readonly version: 1;
  readonly id: string;
  readonly channelKey: string;
  readonly conversationId?: string;
  readonly created: string;
  readonly modified: string;
  readonly backend?: AntigravitySessionBackend;
  readonly events: readonly AntigravitySessionEvent[];
}

export interface YachigravitySessionOptions {
  readonly agentDirectory: string;
  readonly sessionKey: string;
  readonly mode: "new" | "resume";
}

export interface YachigravitySessionHandle {
  readonly path: string;
  readonly value: AntigravitySession;
}

export async function openSession(
  options: YachigravitySessionOptions,
): Promise<YachigravitySessionHandle> {
  const sessionDirectory = resolve(
    options.agentDirectory,
    "sessions",
    encodeURIComponent(options.sessionKey),
  );
  await mkdir(sessionDirectory, { recursive: true });

  if (options.mode === "resume") {
    const existing = await findLatestSession(sessionDirectory);
    if (existing) return existing;
  }

  const now = new Date().toISOString();
  const value: AntigravitySession = {
    version: 1,
    id: randomUUID(),
    channelKey: options.sessionKey,
    created: now,
    modified: now,
    events: [],
  };
  const path = join(sessionDirectory, `${value.id}.json`);
  await writeSession(path, value);
  return { path, value };
}

export async function writeSession(path: string, value: AntigravitySession): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export async function prepareSessionForCli(
  handle: YachigravitySessionHandle,
): Promise<YachigravitySessionHandle> {
  if (handle.value.backend === "cli") return handle;

  const value: AntigravitySession = {
    ...handle.value,
    backend: "cli",
    conversationId: undefined,
  };
  await writeSession(handle.path, value);
  return { path: handle.path, value };
}

export async function readSession(path: string): Promise<AntigravitySession | undefined> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error(`Antigravity session is not valid JSON: ${path}`, { cause: error });
  }

  if (!isSession(value)) {
    throw new Error(`Antigravity session has an invalid shape: ${path}`);
  }
  return value;
}

async function findLatestSession(
  directory: string,
): Promise<YachigravitySessionHandle | undefined> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }

  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(directory, entry.name));
  const sessions = await Promise.all(
    paths.map(async (path) => {
      const value = await readSession(path);
      return value ? { path, value } : undefined;
    }),
  );

  return sessions
    .filter((session): session is YachigravitySessionHandle => session !== undefined)
    .sort((left, right) => right.value.modified.localeCompare(left.value.modified))[0];
}

function isSession(value: unknown): value is AntigravitySession {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.channelKey !== "string" ||
    typeof value.created !== "string" ||
    typeof value.modified !== "string" ||
    !Array.isArray(value.events)
  ) {
    return false;
  }
  if (value.backend !== undefined && value.backend !== "cli" && value.backend !== "python-sdk") {
    return false;
  }
  if (value.conversationId !== undefined && typeof value.conversationId !== "string") return false;
  return value.events.every(isSessionEvent);
}

function isSessionEvent(value: unknown): value is AntigravitySessionEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    (value.kind === "user" ||
      value.kind === "assistant" ||
      value.kind === "tool" ||
      value.kind === "status") &&
    (value.role === undefined || value.role === "user" || value.role === "assistant") &&
    typeof value.summary === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
