// The chance a retry clears (F4). The sandbox decides by amount, not timing, so this documented model picks each
// outcome. It takes no route: any difference between routes comes from when each one retries.

import { seedConfig } from "../../../config/seed.config";
import { ruleFor } from "../declines";

export type OddsInput = { firstCode: string; lastCode: string; failedRetries: number; dayOfMonth: number };

const UNKNOWN_SOFT_ODDS = 0.1; // a soft code outside the seed's decline mix (e.g. remapped by the sandbox)

export function successChance({ firstCode, lastCode, failedRetries, dayOfMonth }: OddsInput): number {
  if (ruleFor(firstCode).type === "hard" || ruleFor(lastCode).type === "hard") return 0;
  if (firstCode !== "2001") return seedConfig.declineMix.find((d) => String(d.code) === firstCode)?.retrySuccess ?? UNKNOWN_SOFT_ODDS;

  const { paydays, insufficientFunds: f } = seedConfig.trialModel;
  const sincePayday = Math.min(...paydays.map((p) => (dayOfMonth >= p ? dayOfMonth - p : Infinity)));
  const base = sincePayday === 0 ? f.onPayday : sincePayday <= f.afterPaydayDays ? f.afterPayday : f.otherDay;
  return base * f.decayPerFailedRetry ** failedRetries;
}
