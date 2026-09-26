import { Type, type Static } from "typebox";

const EffortSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);
const DiscordIdSchema = Type.String({ minLength: 1, pattern: "^[0-9]+$" });
const DiscordAccessSchema = Type.Union([Type.Literal("allow"), Type.Literal("deny")]);

const DiscordThreadAccessSchema = Type.Object(
  {
    access: Type.Optional(DiscordAccessSchema),
  },
  { additionalProperties: false },
);

const DiscordChannelAccessSchema = Type.Object(
  {
    access: Type.Optional(DiscordAccessSchema),
    threads: Type.Optional(Type.Record(DiscordIdSchema, DiscordThreadAccessSchema)),
  },
  { additionalProperties: false },
);

const DiscordGuildAccessSchema = Type.Object(
  {
    access: Type.Optional(DiscordAccessSchema),
    channels: Type.Optional(Type.Record(DiscordIdSchema, DiscordChannelAccessSchema)),
  },
  { additionalProperties: false },
);

const AgentPromptConfigurationSchema = Type.Object(
  {
    systemPromptFile: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const LlmConfigurationSchema = Type.Object(
  {
    backend: Type.Optional(Type.Literal("cli")),
    command: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
    agent: Type.Optional(Type.String({ minLength: 1 })),
    effort: Type.Optional(EffortSchema),
    printTimeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
    dangerouslySkipPermissions: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const WebUiConfigurationSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    host: Type.Optional(Type.String({ minLength: 1 })),
    port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  },
  { additionalProperties: false },
);

export const YachigravityConfigSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String({ minLength: 1 })),
    version: Type.Literal(1),
    llm: LlmConfigurationSchema,
    runtime: Type.Object(
      {
        agentDir: Type.String({ minLength: 1 }),
        logDir: Type.Optional(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
    discord: Type.Object(
      {
        access: Type.Object(
          {
            default: DiscordAccessSchema,
            directMessages: DiscordAccessSchema,
            guilds: Type.Optional(Type.Record(DiscordIdSchema, DiscordGuildAccessSchema)),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    agents: Type.Optional(
      Type.Object(
        {
          discord: Type.Optional(AgentPromptConfigurationSchema),
        },
        { additionalProperties: false },
      ),
    ),
    features: Type.Object(
      {
        webui: Type.Optional(WebUiConfigurationSchema),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: "https://github.com/OJII3/yachigravity/blob/main/config/yachigravity.schema.json",
    additionalProperties: false,
    title: "Yachigravity configuration",
  },
);

export type YachigravityConfig = Static<typeof YachigravityConfigSchema>;
