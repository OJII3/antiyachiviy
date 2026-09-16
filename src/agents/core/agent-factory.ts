import type { AgentDefinition } from "./agent-definition";
import type { AgentRuntime } from "./agent-runtime";

export interface AgentCreationOptions {
  readonly sessionKey: string;
}

export interface AgentFactory {
  create(definition: AgentDefinition, options: AgentCreationOptions): Promise<AgentRuntime>;
}
