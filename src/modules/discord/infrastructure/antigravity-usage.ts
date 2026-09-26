import { spawn } from "node:child_process";

import type { WeeklyUsage } from "../domain/weekly-usage";
import type { WeeklyUsageProvider } from "../ports/weekly-usage-provider";

const USAGE_TIMEOUT_MS = 30_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export function createAntigravityUsageProvider(command: string): WeeklyUsageProvider {
  return {
    async getWeeklyUsage(): Promise<WeeklyUsage> {
      const output = await runUsageCommand(command);
      return parseWeeklyUsage(output);
    },
  };
}

export function parseWeeklyUsage(output: string): WeeklyUsage {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error("agy returned invalid usage JSON", { cause: error });
  }

  const quota = findWeeklyQuota(value);
  if (!quota) {
    throw new Error("agy usage JSON did not contain a weekly quota");
  }

  const remainingFraction = quota.remaining_fraction;
  if (
    typeof remainingFraction !== "number" ||
    !Number.isFinite(remainingFraction) ||
    remainingFraction < 0 ||
    remainingFraction > 1
  ) {
    throw new Error("agy weekly quota has an invalid remaining fraction");
  }

  const resetInSeconds = getResetInSeconds(quota);

  return {
    remainingPercentage: Math.round(remainingFraction * 100),
    resetInDays:
      resetInSeconds === undefined
        ? undefined
        : Math.max(0, Math.ceil(resetInSeconds / (MILLISECONDS_PER_DAY / 1_000))),
  };
}

function getResetInSeconds(quota: WeeklyQuotaRecord): number | undefined {
  if (typeof quota.reset_in_seconds === "number" && Number.isFinite(quota.reset_in_seconds)) {
    return quota.reset_in_seconds;
  }
  if (typeof quota.reset_time !== "string") return undefined;

  const resetAt = Date.parse(quota.reset_time);
  return Number.isFinite(resetAt) ? (resetAt - Date.now()) / 1_000 : undefined;
}

async function runUsageCommand(command: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, ["-p", "/usage", "--output-format", "json"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("agy usage command timed out"));
    }, USAGE_TIMEOUT_MS);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Failed to start agy usage command", { cause: error }));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const details = stderr.trim();
        reject(
          new Error(
            `agy usage command failed (${code ?? signal ?? "unknown"})${details ? `: ${details}` : ""}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

interface WeeklyQuotaRecord {
  readonly remaining_fraction?: unknown;
  readonly reset_in_seconds?: unknown;
  readonly reset_time?: unknown;
}

function findWeeklyQuota(value: unknown, weeklyContext = false): WeeklyQuotaRecord | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
    try {
      return findWeeklyQuota(JSON.parse(trimmed), weeklyContext);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const quota = findWeeklyQuota(item, weeklyContext);
      if (quota) return quota;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const hasWeeklyMarker = Object.entries(value).some(
    ([key, nested]) =>
      /(?:bucket|id|key|model|name)/iu.test(key) &&
      typeof nested === "string" &&
      /week/iu.test(nested),
  );
  const currentWeeklyContext = weeklyContext || hasWeeklyMarker;
  if (currentWeeklyContext && "remaining_fraction" in value) return value;

  for (const [key, nested] of Object.entries(value)) {
    const quota = findWeeklyQuota(nested, currentWeeklyContext || /week/iu.test(key));
    if (quota) return quota;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
