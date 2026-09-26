import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { Logger } from "pino";

import type { AgentDefinition } from "@agents/core/agent-definition";
import type { AgentFactory, AgentCreationOptions } from "@agents/core/agent-factory";
import type { AgentPrompt, AgentRuntime } from "@agents/core/agent-runtime";
import type { SessionMode } from "@app/cli-options";
import {
  type AntigravitySession,
  type AntigravitySessionEvent,
  openSession,
  prepareSessionForBackend,
  writeSession,
} from "./session-store";
import { parseStreamEvent } from "./antigravity-agent-runtime";

const DEFAULT_PYTHON_COMMAND = "uv";
const DEFAULT_PYTHON_PROJECT_DIRECTORY = resolve(process.cwd(), "python");
const SUMMARY_MAX_LENGTH = 500;

export interface PythonAntigravityAgentFactoryOptions {
  readonly agentDir: string;
  readonly sessionMode: SessionMode;
  readonly pythonCommand?: string;
  readonly pythonProjectDirectory?: string;
  readonly llm: {
    readonly model?: string;
    readonly dangerouslySkipPermissions?: boolean;
  };
  readonly logger: Logger;
}

interface PendingPrompt {
  readonly resolve: (response: string) => void;
  readonly reject: (error: Error) => void;
}

interface PythonWorkerConfiguration {
  readonly event: "configure";
  readonly systemPrompt: string;
  readonly saveDir: string;
  readonly conversationId?: string;
  readonly workspace: string;
  readonly model?: string;
  readonly dangerouslySkipPermissions: boolean;
}

export function createPythonAntigravityAgentFactory({
  agentDir,
  llm,
  logger,
  pythonCommand = DEFAULT_PYTHON_COMMAND,
  pythonProjectDirectory = DEFAULT_PYTHON_PROJECT_DIRECTORY,
  sessionMode,
}: PythonAntigravityAgentFactoryOptions): AgentFactory {
  return {
    async create(
      definition: AgentDefinition,
      options: AgentCreationOptions,
    ): Promise<AgentRuntime> {
      const session = await prepareSessionForBackend(
        await openSession({
          agentDirectory: agentDir,
          mode: sessionMode,
          sessionKey: options.sessionKey,
        }),
        "python-sdk",
      );
      return new PythonAntigravityAgentRuntime(
        session.path,
        session.value,
        options.sessionKey,
        definition.systemPrompt,
        {
          agentDir,
          dangerouslySkipPermissions: llm.dangerouslySkipPermissions ?? false,
          logger,
          model: llm.model,
          pythonCommand,
          pythonProjectDirectory,
        },
      );
    },
  };
}

class PythonAntigravityAgentRuntime implements AgentRuntime {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: PendingPrompt;
  private queue: Promise<string> = Promise.resolve("");
  private disposed = false;
  private session: AntigravitySession;

  constructor(
    private readonly sessionPath: string,
    session: AntigravitySession,
    private readonly sessionKey: string,
    private readonly systemPrompt: string,
    private readonly options: PythonAntigravityRuntimeOptions,
  ) {
    this.session = session;
  }

  prompt(prompt: AgentPrompt): Promise<string> {
    const run = this.queue.then(() => this.runPrompt(prompt));
    this.queue = run.catch(() => "");
    return run;
  }

  dispose(): void {
    this.disposed = true;
    this.pending?.reject(new Error("Antigravity Python agent was disposed"));
    this.pending = undefined;
    this.child?.kill("SIGTERM");
    this.child?.stdin.destroy();
    this.child = undefined;
  }

  private async runPrompt(prompt: AgentPrompt): Promise<string> {
    if (this.disposed) throw new Error("Antigravity Python agent was disposed");

    await this.appendEvent({
      id: randomUUID(),
      kind: "user",
      role: "user",
      summary: truncate(prompt.text || "(画像のみ)", SUMMARY_MAX_LENGTH),
      content: prompt.text,
      timestamp: new Date().toISOString(),
    });

    await this.ensureProcess();
    const child = this.child;
    if (!child || child.killed || child.exitCode !== null) {
      throw new Error("Antigravity Python worker is not running");
    }
    return new Promise<string>((resolveResponse, rejectResponse) => {
      this.pending = { reject: rejectResponse, resolve: resolveResponse };
      const message = JSON.stringify({
        event: "user",
        message: {
          content: prompt.text || "(画像のみ)",
          images: prompt.images,
        },
      });
      child.stdin.write(`${message}\n`, (error) => {
        if (!error) return;
        this.pending = undefined;
        rejectResponse(
          new Error("Failed to write to Antigravity Python worker stdin", { cause: error }),
        );
      });
    });
  }

  private async ensureProcess(): Promise<void> {
    if (this.child && !this.child.killed && this.child.exitCode === null) return;
    if (this.disposed) throw new Error("Antigravity Python agent was disposed");

    const workspace = await this.prepareWorkspace();

    const child = spawn(
      this.options.pythonCommand,
      buildPythonWorkerArgs(this.options.pythonProjectDirectory),
      {
        cwd: workspace,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.options.logger.info(
      {
        command: this.options.pythonCommand,
        event: "antigravity_python_process_started",
        sessionId: this.session.id,
      },
      "Started Antigravity Python SDK worker",
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.options.logger.debug(
        { event: "antigravity_python_stderr", sessionId: this.session.id, text: chunk.trim() },
        "Antigravity Python worker wrote to stderr",
      );
    });
    child.once("error", (error) => {
      if (this.child === child) this.child = undefined;
      this.failPending(new Error("Antigravity Python worker failed", { cause: error }));
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.pending) {
        this.failPending(
          new Error(
            `Antigravity Python worker exited before a result (${code ?? signal ?? "unknown"})`,
          ),
        );
      }
    });

    const lines = createInterface({ input: child.stdout });
    void this.consumeOutput(lines).catch((error: unknown) => {
      if (this.child === child) this.child = undefined;
      child.kill("SIGTERM");
      this.options.logger.error(
        { err: error, event: "antigravity_python_output_failed", sessionId: this.session.id },
        "Failed to read Antigravity Python worker output",
      );
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    });

    const configuration: PythonWorkerConfiguration = {
      event: "configure",
      systemPrompt: this.systemPrompt,
      saveDir: resolve(this.options.agentDir, "python-sessions", this.session.id),
      conversationId: this.session.conversationId,
      workspace,
      model: this.options.model,
      dangerouslySkipPermissions: this.options.dangerouslySkipPermissions,
    };
    child.stdin.write(`${JSON.stringify(configuration)}\n`);
  }

  private async consumeOutput(lines: AsyncIterable<string>): Promise<void> {
    for await (const line of lines) {
      if (!line.trim()) continue;

      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new Error("Antigravity Python worker emitted invalid JSON", { cause: error });
      }
      const event = parseStreamEvent(value);
      if (!event) continue;

      const conversationId = extractConversationId(event);
      if (conversationId && conversationId !== this.session.conversationId) {
        this.session = { ...this.session, conversationId, modified: new Date().toISOString() };
        await writeSession(this.sessionPath, this.session);
      }

      if (event.event === "step_update") await this.recordStep(event.step_update);
      if (event.event !== "result" || !this.pending) continue;

      const pending = this.pending;
      this.pending = undefined;
      const result = event.result;
      const status = typeof result?.status === "string" ? result.status : "UNKNOWN";
      const response = typeof result?.response === "string" ? result.response : "";
      if (status !== "SUCCESS") {
        const reason = typeof result?.error === "string" ? result.error : status;
        await this.appendEvent({
          id: randomUUID(),
          kind: "status",
          summary: `Antigravity ${status}: ${truncate(reason, SUMMARY_MAX_LENGTH)}`,
          content: result,
          timestamp: new Date().toISOString(),
        });
        pending.reject(new Error(`Antigravity Python turn failed: ${reason}`));
        continue;
      }

      await this.appendEvent({
        id: randomUUID(),
        kind: "assistant",
        role: "assistant",
        summary: truncate(response, SUMMARY_MAX_LENGTH),
        content: response,
        timestamp: new Date().toISOString(),
      });
      pending.resolve(response);
    }
  }

  private async recordStep(step: Record<string, unknown> | undefined): Promise<void> {
    if (!step || step.step_type !== "tool" || (step.state !== undefined && step.state !== "DONE")) {
      return;
    }
    const toolName = typeof step.tool_name === "string" ? step.tool_name : "unknown";
    const toolInfo = "tool_info" in step ? sanitizeValue(step.tool_info) : undefined;
    await this.appendEvent({
      id: randomUUID(),
      kind: "tool",
      summary: truncate(`Tool: ${toolName}`, SUMMARY_MAX_LENGTH),
      content: toolInfo ?? { toolName },
      timestamp: new Date().toISOString(),
    });
  }

  private async appendEvent(event: AntigravitySessionEvent): Promise<void> {
    this.session = {
      ...this.session,
      events: [...this.session.events, event],
      modified: event.timestamp,
    };
    await writeSession(this.sessionPath, this.session);
  }

  private async prepareWorkspace(): Promise<string> {
    const directory = resolve(
      this.options.agentDir,
      "workspaces",
      encodeURIComponent(this.sessionKey),
    );
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    pending.reject(error);
  }
}

export interface PythonAntigravityRuntimeOptions {
  readonly agentDir: string;
  readonly pythonCommand: string;
  readonly pythonProjectDirectory: string;
  readonly model?: string;
  readonly dangerouslySkipPermissions: boolean;
  readonly logger: Logger;
}

export function buildPythonWorkerArgs(projectDirectory: string): string[] {
  return ["run", "--project", projectDirectory, "--frozen", "python", "-m", "yachigravity_agent"];
}

function extractConversationId(event: ReturnType<typeof parseStreamEvent>): string | undefined {
  if (!event) return undefined;
  const fromEvent = event.conversation_id;
  if (typeof fromEvent === "string" && fromEvent) return fromEvent;
  const fromInit = event.init?.conversation_id;
  if (typeof fromInit === "string" && fromInit) return fromInit;
  const fromResult = event.result?.conversation_id;
  return typeof fromResult === "string" && fromResult ? fromResult : undefined;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      key === "output" ? truncate(String(nested), SUMMARY_MAX_LENGTH) : sanitizeValue(nested),
    ]),
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
