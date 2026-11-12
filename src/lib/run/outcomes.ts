// The chance a retry clears (F4). The sandbox decides by amount, not timing, so this documented model picks each
// outcome. Odds come from the merchant's assumptions (src/lib/assumptions.ts, editable on trial setup):
// Route A recovers `currentRecovery` of soft declines over its retries; Route B recovers `currentRecovery + smartUplift`.
// Route B still retries on its own schedule (paydays, next-day for outages), but its advantage is the stated uplift.

import { activeAssumptions, getActivePolicy, perRetryOdds } from "../assumptions";
import { ruleFor } from "../declines";
import type { Route } from "../trial";

// plannedRetries: how many retries this route schedules for the invoice, so each route hits its stated recovery rate.
export type OddsInput = { firstCode: string; lastCode: string; failedRetries: number; dayOfMonth: number; route: Route; plannedRetries?: number };


export function successChance({ firstCode, lastCode, route, plannedRetries = getActivePolicy().maxRetries }: OddsInput): number {
  if (ruleFor(firstCode).type === "hard" || ruleFor(lastCode).type === "hard") return 0;
  const a = activeAssumptions();
  return perRetryOdds(route === "B" ? a.currentRecovery + a.smartUplift : a.currentRecovery, Math.max(1, plannedRetries));
}
