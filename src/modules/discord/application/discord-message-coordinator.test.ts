import assert from "node:assert/strict";
import test from "node:test";

import type { AgentFactory } from "@agents/core/agent-factory";
import { createLogger } from "@app/logger";
import type { DiscordMessage } from "@modules/discord/domain/discord-message";
import { DiscordOperatingState } from "@modules/discord/domain/discord-operating-state";
import type { DiscordService } from "@modules/discord/ports/discord-service";
import type { DiscordReplyPolicy } from "@modules/discord/ports/reply-policy";
import { DiscordMessageCoordinator } from "./discord-message-coordinator";

const message: DiscordMessage = {
  author: { bot: false, displayName: "さつき", id: "user-1", username: "satsuki" },
  channelId: "channel-1",
  content: "こんにちは",
  id: "message-1",
  images: [],
};

test("generates and sends only after Jev approves both decisions", async () => {
  const decisions: string[] = [];
  const sent: string[] = [];
  const agentFactory: AgentFactory = {
    async create(definition, options) {
      assert.equal(definition.systemPrompt, "system prompt");
      assert.equal(options.sessionKey, "discord-channel:channel-1");
      return {
        async prompt(prompt) {
          assert.equal(prompt.text, "こんにちは");
          return "返答です";
        },
        dispose() {},
      };
    },
  };
  const discordService = {
    async sendMessage(_channelId: string, content: string) {
      sent.push(content);
    },
  } as Pick<DiscordService, "sendMessage"> as DiscordService;
  const replyPolicy: DiscordReplyPolicy = {
    async shouldGenerateReply() {
      decisions.push("generate");
      return true;
    },
    async shouldSendReply(_message, response) {
      decisions.push(`send:${response}`);
      return true;
    },
  };
  const coordinator = new DiscordMessageCoordinator({
    agentFactory,
    discordService,
    logger: createLogger({ level: "silent" }),
    operatingState: new DiscordOperatingState(),
    replyPolicy,
    systemPrompt: "system prompt",
  });

  await coordinator.handleDiscordMessage(message);

  assert.deepEqual(decisions, ["generate", "send:返答です"]);
  assert.deepEqual(sent, ["返答です"]);
  await coordinator.dispose();
});

test("does not create a character agent when Jev declines generation", async () => {
  const agentFactory: AgentFactory = {
    async create() {
      assert.fail("character agent should not be created");
    },
  };
  const replyPolicy: DiscordReplyPolicy = {
    async shouldGenerateReply() {
      return false;
    },
    async shouldSendReply() {
      assert.fail("send decision should not run without a generated response");
    },
  };
  const coordinator = new DiscordMessageCoordinator({
    agentFactory,
    discordService: { async sendMessage() {} } as unknown as DiscordService,
    logger: createLogger({ level: "silent" }),
    operatingState: new DiscordOperatingState(),
    replyPolicy,
    systemPrompt: "system prompt",
  });

  await coordinator.handleDiscordMessage(message);
  await coordinator.dispose();
});

test("discards a generated response when Jev declines delivery", async () => {
  const sent: string[] = [];
  const agentFactory: AgentFactory = {
    async create() {
      return {
        async prompt() {
          return "candidate";
        },
        dispose() {},
      };
    },
  };
  const replyPolicy: DiscordReplyPolicy = {
    async shouldGenerateReply() {
      return true;
    },
    async shouldSendReply() {
      return false;
    },
  };
  const coordinator = new DiscordMessageCoordinator({
    agentFactory,
    discordService: {
      async sendMessage(_channelId, content) {
        sent.push(content);
      },
    } as DiscordService,
    logger: createLogger({ level: "silent" }),
    operatingState: new DiscordOperatingState(),
    replyPolicy,
    systemPrompt: "system prompt",
  });

  await coordinator.handleDiscordMessage(message);

  assert.deepEqual(sent, []);
  await coordinator.dispose();
});
