import assert from "node:assert/strict";
import test from "node:test";

import { DiscordAgent } from "./discord-agent";
import type { AgentFactory } from "@agents/core/agent-factory";
import type { DiscordMessage } from "@modules/discord/domain/discord-message";
import type { DiscordService } from "@modules/discord/ports/discord-service";

const message: DiscordMessage = {
  author: { bot: false, displayName: "さつき", id: "user-1", username: "satsuki" },
  channelId: "channel-1",
  content: "こんにちは",
  id: "message-1",
  images: [],
};

test("sends the Antigravity result to Discord", async () => {
  let receivedPrompt = "";
  const sent: string[] = [];
  const agentFactory: AgentFactory = {
    async create(definition, options) {
      assert.equal(definition.systemPrompt, "system prompt");
      assert.equal(options.sessionKey, "discord-channel:channel-1");
      return {
        async prompt(prompt) {
          receivedPrompt = prompt.text;
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
  } as Pick<DiscordService, "sendMessage">;

  const agent = await DiscordAgent.create(
    agentFactory,
    discordService as DiscordService,
    message.channelId,
    "system prompt",
  );
  await agent.prompt(message);

  assert.match(receivedPrompt, /さつき/);
  assert.deepEqual(sent, ["返答です"]);
  agent.dispose();
});

test("does not send an empty Antigravity result", async () => {
  const sent: string[] = [];
  const agentFactory: AgentFactory = {
    async create() {
      return {
        async prompt() {
          return "  \n";
        },
        dispose() {},
      };
    },
  };
  const discordService = {
    async sendMessage(_channelId: string, content: string) {
      sent.push(content);
    },
  } as Pick<DiscordService, "sendMessage">;

  const agent = await DiscordAgent.create(
    agentFactory,
    discordService as DiscordService,
    message.channelId,
    "system prompt",
  );
  await agent.prompt(message);

  assert.deepEqual(sent, []);
  agent.dispose();
});

test("adds bot-specific conversation guidance only for bot messages", async () => {
  const prompts: string[] = [];
  const agentFactory: AgentFactory = {
    async create() {
      return {
        async prompt(prompt) {
          prompts.push(prompt.text);
          return "";
        },
        dispose() {},
      };
    },
  };
  const discordService = {
    async sendMessage() {},
  } as Pick<DiscordService, "sendMessage">;
  const agent = await DiscordAgent.create(
    agentFactory,
    discordService as DiscordService,
    message.channelId,
    "system prompt",
  );

  await agent.prompt(message);
  await agent.prompt({ ...message, author: { ...message.author, bot: true } });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], "さつき (@satsuki):\nこんにちは");
  assert.match(prompts[1] ?? "", /latest Discord message was sent by another bot/);
  assert.match(prompts[1] ?? "", /self-contained character-driven closing remark/);
  agent.dispose();
});
