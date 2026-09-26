export interface WeeklyUsage {
  readonly remainingPercentage: number;
  readonly resetInDays?: number;
}

export function formatWeeklyUsageActivity(usage: WeeklyUsage | undefined): string {
  const percentage = usage ? `${usage.remainingPercentage}` : "--";
  const resetInDays = usage?.resetInDays === undefined ? "--" : `${usage.resetInDays}`;
  return `${percentage}%/week (reset in ${resetInDays} days)`;
}
