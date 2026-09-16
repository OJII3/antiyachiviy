import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Check, Errors } from "typebox/value";

import { YachigravityConfigSchema, type YachigravityConfig } from "./config-schema";

export const DEFAULT_CONFIG_PATH = "config/yachigravity.json";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function loadConfig(
  configPath = process.env.YACHIGRAVITY_CONFIG_PATH ?? DEFAULT_CONFIG_PATH,
): Promise<YachigravityConfig> {
  const resolvedConfigPath = resolve(configPath);

  let content: string;
  try {
    content = await readFile(resolvedConfigPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(
        `Yachigravity config was not found: ${resolvedConfigPath}. ` +
          `Copy config/yachigravity.example.json to config/yachigravity.json first.`,
      );
    }

    throw new Error(`Failed to read Yachigravity config: ${resolvedConfigPath}`, {
      cause: error,
    });
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error(`Yachigravity config is not valid JSON: ${resolvedConfigPath}`, {
      cause: error,
    });
  }

  if (!Check(YachigravityConfigSchema, value)) {
    const errors = Errors(YachigravityConfigSchema, value)
      .slice(0, 5)
      .map((error) => `${error.instancePath || "$"}: ${error.message}`)
      .join("; ");

    throw new Error(`Yachigravity config is invalid: ${resolvedConfigPath}. ${errors}`);
  }

  return value;
}
