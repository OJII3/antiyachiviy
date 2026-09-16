import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "pino";

import type { DiscordService } from "@modules/discord/ports/discord-service";

const MAX_BODY_BYTES = 64 * 1024;
const ROUTE = "/discord-send";

export interface DiscordSendMcpCredentials {
  readonly endpoint: string;
  readonly token: string;
}

export class DiscordSendMcpGateway {
  private readonly tokensByChannel = new Map<string, string>();
  private readonly channelsByToken = new Map<string, string>();
  private server?: Server;
  private endpoint?: string;

  constructor(
    private readonly discordService: Pick<DiscordService, "sendMessage">,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    if (this.server) return;

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Discord send gateway did not receive a TCP address"));
          return;
        }
        this.endpoint = `http://127.0.0.1:${(address as AddressInfo).port}${ROUTE}`;
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = undefined;
    this.endpoint = undefined;
    this.tokensByChannel.clear();
    this.channelsByToken.clear();
  }

  registerChannel(channelId: string): DiscordSendMcpCredentials {
    if (!this.server || !this.endpoint) {
      throw new Error("Discord send gateway has not started");
    }

    const existingToken = this.tokensByChannel.get(channelId);
    if (existingToken) {
      return { endpoint: this.endpoint, token: existingToken };
    }

    const token = randomBytes(32).toString("hex");
    this.tokensByChannel.set(channelId, token);
    this.channelsByToken.set(token, channelId);
    return { endpoint: this.endpoint, token };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== ROUTE) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }

    const token = bearerToken(request.headers.authorization);
    const channelId = token ? this.channelsByToken.get(token) : undefined;
    if (!channelId) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    try {
      const body = JSON.parse(await readBody(request)) as unknown;
      if (!isRecord(body) || typeof body.content !== "string" || body.content.length === 0) {
        sendJson(response, 400, { error: "content must be a non-empty string" });
        return;
      }

      await this.discordService.sendMessage(channelId, body.content);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      this.logger.error(
        { err: error, event: "discord_send_mcp_request_failed", channelId },
        "Failed to send an MCP Discord message",
      );
      sendJson(response, 500, { error: "Failed to send Discord message" });
    }
  }
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length);
  return token || undefined;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        request.destroy();
        reject(new Error("Request body is too large"));
        return;
      }
      chunks.push(buffer);
    });
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
