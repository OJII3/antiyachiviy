import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Logger } from "pino";

import type { AgentDefinition } from "@agents/core/agent-definition";
import type { AgentFactory, AgentCreationOptions } from "@agents/core/agent-factory";
import type { AgentPrompt, AgentRuntime } from "@agents/core/agent-runtime";
import type { SessionMode } from "@app/cli-options";
import {
  type AntigravitySession,
  type AntigravitySessionEvent,
  openSession,
  prepareSessionForCli,
  writeSession,
} from "./session-store";

const DEFAULT_COMMAND = "agy";
const DEFAULT_TIMEOUT_SECONDS = 300;
const SUMMARY_MAX_LENGTH = 500;
const DISCORD_REPLY_INSTRUCTIONS = [
  "Discord のメッセージには、発言者の名前や ID は含めません。返信の場合は返信先の本文も示します。",
  "一般知識や検索で得た情報を説明することを主目的にせず、このキャラクターなら何を感じ、どう話すかを主軸に返答してください。情報提供が必要な場合も、説明に終始せず、キャラクターらしい受け止め方や言い回しを優先してください。",
  "返答例（メッセージ: 今日はちょっと疲れた〜）",
  "おぉ〜、おつかれさまだよ〜。今日はもう、ゆるっと休んじゃお。明日になればまた、よ〜し！って動けるからさ〜。",
  "返答は本文だけにしてください。鍵括弧で囲まず、前置き、説明文、見出しを付けないでください。",
].join("\n");

export interface AntigravityAgentFactoryOptions {
  readonly agentDir: string;
  readonly sessionMode: SessionMode;
  readonly llm: {
    readonly command?: string;
    readonly model?: string;
    readonly agent?: string;
    readonly effort?: "low" | "medium" | "high";
    readonly printTimeoutSeconds?: number;
    readonly dangerouslySkipPermissions?: boolean;
  };
  readonly logger: Logger;
}

interface StreamResult {
  readonly conversation_id?: unknown;
  readonly status?: unknown;
  readonly response?: unknown;
  readonly error?: unknown;
}

interface StreamEvent {
  readonly event?: unknown;
  readonly conversation_id?: unknown;
  readonly init?: { readonly conversation_id?: unknown };
  readonly step_update?: Record<string, unknown>;
  readonly result?: StreamResult;
}

interface PendingPrompt {
  readonly resolve: (response: string) => void;
  readonly reject: (error: Error) => void;
}

export function createAntigravityAgentFactory({
  agentDir,
  llm,
  logger,
  sessionMode,
}: AntigravityAgentFactoryOptions): AgentFactory {
  return {
    async create(
      definition: AgentDefinition,
      options: AgentCreationOptions,
    ): Promise<AgentRuntime> {
      const session = await prepareSessionForCli(
        await openSession({
          agentDirectory: agentDir,
          mode: sessionMode,
          sessionKey: options.sessionKey,
        }),
      );
      return new AntigravityAgentRuntime(
        session.path,
        session.value,
        options.sessionKey,
        definition.systemPrompt,
        {
          agentDirectory: agentDir,
          command: llm.command ?? DEFAULT_COMMAND,
          conversationId: session.value.conversationId,
          effort: llm.effort,
          agent: llm.agent,
          logger,
          model: llm.model,
          printTimeoutSeconds: llm.printTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
          dangerouslySkipPermissions: llm.dangerouslySkipPermissions ?? false,
        },
      );
    },
  };
}

export class AntigravityAgentRuntime implements AgentRuntime {
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
    private readonly options: AntigravityRuntimeOptions,
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
    this.pending?.reject(new Error("Antigravity agent was disposed"));
    this.pending = undefined;
    this.child?.kill("SIGTERM");
    this.child?.stdin.destroy();
    this.child = undefined;
  }

  private async runPrompt(prompt: AgentPrompt): Promise<string> {
    if (this.disposed) throw new Error("Antigravity agent was disposed");

    const content = formatPrompt(
      this.systemPrompt,
      prompt.text,
      this.session.conversationId !== undefined,
    );
    const userEvent: AntigravitySessionEvent = {
      id: randomUUID(),
      kind: "user",
      role: "user",
      summary: truncate(prompt.text || "(画像のみ)", SUMMARY_MAX_LENGTH),
      content: prompt.text,
      timestamp: new Date().toISOString(),
    };
    await this.appendEvent(userEvent);

    await this.ensureProcess();
    return new Promise<string>((resolveResponse, rejectResponse) => {
      this.pending = { reject: rejectResponse, resolve: resolveResponse };
      const message = JSON.stringify({ event: "user", message: { content } });
      this.child?.stdin.write(`${message}\n`, (error) => {
        if (!error) return;
        this.pending = undefined;
        rejectResponse(new Error("Failed to write to Antigravity stdin", { cause: error }));
      });
    });
  }

  private async ensureProcess(): Promise<void> {
    if (this.child && !this.child.killed && this.child.exitCode === null) return;
    if (this.disposed) throw new Error("Antigravity agent was disposed");

    const child = spawn(
      this.options.command,
      buildAntigravityArgs({ ...this.options, conversationId: this.session.conversationId }),
      {
        cwd: await this.prepareWorkspace(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.options.logger.info(
      {
        command: this.options.command,
        event: "antigravity_process_started",
        sessionId: this.session.id,
      },
      "Started Antigravity headless session",
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.options.logger.debug(
        { event: "antigravity_stderr", sessionId: this.session.id, text: chunk.trim() },
        "Antigravity wrote to stderr",
      );
    });
    child.once("error", (error) => {
      if (this.child === child) this.child = undefined;
      this.failPending(new Error("Antigravity process failed", { cause: error }));
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.pending) {
        this.failPending(
          new Error(`Antigravity process exited before a result (${code ?? signal ?? "unknown"})`),
        );
      }
    });

    const lines = createInterface({ input: child.stdout });
    void this.consumeOutput(lines).catch((error: unknown) => {
      if (this.child === child) this.child = undefined;
      child.kill("SIGTERM");
      this.options.logger.error(
        { err: error, event: "antigravity_output_failed", sessionId: this.session.id },
        "Failed to read Antigravity output",
      );
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private async consumeOutput(lines: AsyncIterable<string>): Promise<void> {
    for await (const line of lines) {
      if (!line.trim()) continue;

      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new Error("Antigravity emitted invalid stream-json", { cause: error });
      }
      const event = parseStreamEvent(value);
      if (!event) continue;

      const conversationId = extractConversationId(event);
      if (conversationId && conversationId !== this.session.conversationId) {
        this.session = { ...this.session, conversationId, modified: new Date().toISOString() };
        await writeSession(this.sessionPath, this.session);
      }

      if (event.event === "step_update") {
        await this.recordStep(event.step_update);
      }

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
        pending.reject(new Error(`Antigravity turn failed: ${reason}`));
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
    const workspaceDirectory = resolve(
      this.options.agentDirectory,
      "workspaces",
      encodeURIComponent(this.sessionKey),
    );
    await mkdir(workspaceDirectory, { recursive: true });
    return workspaceDirectory;
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    pending.reject(error);
  }
}

export interface AntigravityRuntimeOptions {
  readonly agentDirectory: string;
  readonly command: string;
  readonly conversationId?: string;
  readonly model?: string;
  readonly agent?: string;
  readonly effort?: "low" | "medium" | "high";
  readonly printTimeoutSeconds: number;
  readonly dangerouslySkipPermissions: boolean;
  readonly logger: Logger;
}

export function buildAntigravityArgs(
  options: Pick<
    AntigravityRuntimeOptions,
    | "conversationId"
    | "model"
    | "agent"
    | "effort"
    | "printTimeoutSeconds"
    | "dangerouslySkipPermissions"
  >,
): string[] {
  const args = ["--input-format", "stream-json", "--output-format", "stream-json"];
  if (options.conversationId) args.push("--conversation", options.conversationId);
  if (options.model) args.push("--model", options.model);
  if (options.agent) args.push("--agent", options.agent);
  if (options.effort) args.push("--effort", options.effort);
  args.push("--print-timeout", `${options.printTimeoutSeconds}s`);
  if (options.dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
  return args;
}

export function parseStreamEvent(value: unknown): StreamEvent | undefined {
  if (!isRecord(value) || typeof value.event !== "string") return undefined;
  if (value.event === "init") {
    return {
      conversation_id: value.conversation_id,
      event: value.event,
      init: isRecord(value.init) ? value.init : undefined,
    };
  }
  if (value.event === "step_update") {
    return {
      event: value.event,
      step_update: isRecord(value.step_update) ? value.step_update : undefined,
    };
  }
  if (value.event === "result") {
    return { event: value.event, result: isRecord(value.result) ? value.result : {} };
  }
  return undefined;
}

export function formatPrompt(systemPrompt: string, text: string, hasConversation: boolean): string {
  if (hasConversation) return text || "(画像のみ)";

  return (
    `<yachigravity-instructions>\n${systemPrompt}\n\n${DISCORD_REPLY_INSTRUCTIONS}\n` +
    `</yachigravity-instructions>\n\n${text || "(画像のみ)"}`
  );
}

function extractConversationId(event: StreamEvent): string | undefined {
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
