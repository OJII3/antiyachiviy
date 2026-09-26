export interface AgentPrompt {
  readonly text: string;
}

export interface AgentRuntime {
  prompt(prompt: AgentPrompt): Promise<string>;
  dispose(): void;
}
