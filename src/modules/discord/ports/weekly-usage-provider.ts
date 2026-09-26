import type { WeeklyUsage } from "../domain/weekly-usage";

export interface WeeklyUsageProvider {
  getWeeklyUsage(): Promise<WeeklyUsage>;
}
