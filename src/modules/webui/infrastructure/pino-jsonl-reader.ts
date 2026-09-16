import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { PinoViewerEvent, ViewerPage } from "../domain/viewer-event";

const PinoLevelLabels: Readonly<Record<number, string>> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const PinoRecordKeys = new Set(["level", "time", "pid", "hostname", "name", "msg", "event"]);

export interface PinoLogQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly level?: string;
  readonly q?: string;
  readonly channelId?: string;
  readonly event?: string;
}

interface PinoLogCursor {
  readonly file: string;
  readonly line: number | null;
}

export class PinoJsonlReader {
  constructor(private readonly logDirectory: string) {}

  async list(query: PinoLogQuery = {}): Promise<ViewerPage<PinoViewerEvent>> {
    const limit = normalizeLimit(query.limit);
    const files = await this.listFiles();
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    let fileIndex = 0;
    if (cursor) {
      fileIndex = files.findIndex((file) => basename(file) === cursor.file);
      if (fileIndex < 0) throw new Error("Unknown log cursor file");
    }

    const items: PinoViewerEvent[] = [];
    for (; fileIndex < files.length; fileIndex += 1) {
      const filePath = files[fileIndex];
      const lines = await readJsonlLines(filePath);
      const firstLine =
        !cursor || basename(filePath) !== cursor.file
          ? lines.length - 1
          : cursor.line === null
            ? lines.length - 1
            : Math.min(cursor.line, lines.length - 1);

      for (let lineIndex = firstLine; lineIndex >= 0; lineIndex -= 1) {
        const event = parsePinoLine(lines[lineIndex] ?? "", basename(filePath), lineIndex);
        if (!event || !matchesQuery(event, query)) continue;

        items.push(event);
        if (items.length >= limit) {
          return {
            items,
            nextCursor: encodeNextCursor(files, fileIndex, basename(filePath), lineIndex),
          };
        }
      }
    }

    return { items, nextCursor: null };
  }

  private async listFiles(): Promise<string[]> {
    const directory = resolve(this.logDirectory, "pino");

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => resolve(directory, entry.name))
      .sort((left, right) => basename(right).localeCompare(basename(left)));
  }
}

async function readJsonlLines(filePath: string): Promise<string[]> {
  try {
    return (await readFile(filePath, "utf8")).split(/\r?\n/);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function parsePinoLine(
  line: string,
  fileName: string,
  lineIndex: number,
): PinoViewerEvent | undefined {
  if (!line.trim()) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!isRecord(value)) return undefined;
  const time = typeof value.time === "number" ? value.time : Number(value.time);
  if (!Number.isFinite(time)) return undefined;
  const timestamp = new Date(time);
  if (Number.isNaN(timestamp.getTime())) return undefined;

  const level = typeof value.level === "number" ? value.level : Number(value.level);
  if (!Number.isFinite(level)) return undefined;

  const levelLabel = PinoLevelLabels[level] ?? String(level);
  const kind = typeof value.event === "string" && value.event.length > 0 ? value.event : "log";
  const summary = typeof value.msg === "string" && value.msg.length > 0 ? value.msg : kind;
  const attributes: Record<string, unknown> = {};
  for (const [key, attribute] of Object.entries(value)) {
    if (!PinoRecordKeys.has(key)) attributes[key] = attribute;
  }

  return {
    source: "pino",
    id: `pino:${fileName}:${lineIndex}`,
    timestamp: timestamp.toISOString(),
    level,
    levelLabel,
    kind,
    summary,
    attributes,
  };
}

function matchesQuery(event: PinoViewerEvent, query: PinoLogQuery): boolean {
  if (query.level && event.levelLabel !== query.level && String(event.level) !== query.level) {
    return false;
  }
  if (query.event && event.kind !== query.event) return false;
  if (query.channelId && event.attributes.channelId !== query.channelId) return false;

  if (query.q) {
    const needle = query.q.toLocaleLowerCase();
    const haystack =
      `${event.kind} ${event.summary} ${JSON.stringify(event.attributes)}`.toLocaleLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

function encodeNextCursor(
  files: readonly string[],
  fileIndex: number,
  fileName: string,
  lineIndex: number,
): string | null {
  if (lineIndex > 0) return encodeCursor({ file: fileName, line: lineIndex - 1 });
  const nextFile = files[fileIndex + 1];
  return nextFile ? encodeCursor({ file: basename(nextFile), line: null }) : null;
}

function encodeCursor(cursor: PinoLogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): PinoLogCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid log cursor");
  }

  if (!isRecord(decoded) || typeof decoded.file !== "string" || decoded.file.length === 0) {
    throw new Error("Invalid log cursor");
  }
  if (
    decoded.line !== null &&
    (typeof decoded.line !== "number" || !Number.isInteger(decoded.line) || decoded.line < 0)
  ) {
    throw new Error("Invalid log cursor");
  }

  return { file: decoded.file, line: decoded.line };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new Error("Log limit must be an integer between 1 and 200");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
