// When each route retries a failed renewal (F4). Route A replays the merchant's existing schedule; Route B is a
// Smart Retries–style policy. A policy sees only the invoice's own history.

import { seedConfig } from "../../../config/seed.config";
import { getActivePolicy } from "../assumptions";
import { ruleFor } from "../declines";
import type { Route } from "../trial";
import { dayOfMonth } from "./calendar";

export type AttemptView = { day: number; code: string; approved: boolean };
export type History = { firstDay: number; attempts: AttemptView[] }; // attempts[0] is the failed renewal
export type PolicyContext = { startDate: string; windowDays: number };

const maxRetries = () => getActivePolicy().maxRetries; // both routes get the same number of tries
const isHard = (code: string) => ruleFor(code).type === "hard";

// Route A: every N days, M times, for every decline code (the trial excludes hard first declines before asking).
function routeA(h: History, ctx: PolicyContext): number | null {
  const retriesDone = h.attempts.length - 1;
  if (retriesDone >= maxRetries()) return null;
  const day = h.firstDay + getActivePolicy().retryEveryDays * (retriesDone + 1);
  return day <= h.firstDay + ctx.windowDays ? day : null;
}

// Days Route B plans to retry, from the failed renewal's code.
export function plannedRetryDays(firstCode: string, firstDay: number, ctx: PolicyContext): number[] {
  const { paydays, routeB } = seedConfig.trialModel;
  const end = firstDay + ctx.windowDays;
  const offsets = (list: readonly number[]) => list.map((o) => firstDay + o).filter((d) => d <= end);
  if (firstCode === "3000") return offsets(routeB.networkRetryDays);
  if (firstCode !== "2001") return offsets(routeB.otherSoftRetryDays);
  // Insufficient funds: wait for the next payday, then try once more shortly after.
  const days: number[] = [];
  for (let d = firstDay + 1; d <= end; d++) {
    if (!(paydays as readonly number[]).includes(dayOfMonth(ctx.startDate, d))) continue;
    days.push(d);
    if (d + routeB.afterPaydayRetryDays <= end) days.push(d + routeB.afterPaydayRetryDays);
  }
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : offsets(routeB.insufficientFundsFallbackDays);
}

// Route B: no retry after a hard decline, timing by decline code, capped by the network retry rule.
function routeB(h: History, ctx: PolicyContext): number | null {
  const first = h.attempts[0];
  const last = h.attempts[h.attempts.length - 1];
  const retriesDone = h.attempts.length - 1;
  if (isHard(last.code) || retriesDone >= maxRetries()) return null;
  const cap = ruleFor(first.code).retryCap;
  if (cap != null && retriesDone >= cap) return null;
  return plannedRetryDays(first.code, h.firstDay, ctx).find((d) => d > last.day) ?? null;
}

// The day of the invoice's next retry, or null when its route gives up. Always after the last attempt.
export function nextRetryDay(route: Route, h: History, ctx: PolicyContext): number | null {
  if (h.attempts.some((a) => a.approved)) return null;
  return route === "A" ? routeA(h, ctx) : routeB(h, ctx);
}
