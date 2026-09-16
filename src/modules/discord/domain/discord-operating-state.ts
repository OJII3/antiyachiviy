export type DiscordOperatingMode = "active" | "paused";

export class DiscordOperatingState {
  private currentMode: DiscordOperatingMode;

  constructor(initialMode: DiscordOperatingMode = "active") {
    this.currentMode = initialMode;
  }

  get mode(): DiscordOperatingMode {
    return this.currentMode;
  }

  isActive(): boolean {
    return this.currentMode === "active";
  }

  setMode(mode: DiscordOperatingMode): void {
    this.currentMode = mode;
  }
}
