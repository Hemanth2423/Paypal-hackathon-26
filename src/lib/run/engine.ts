// Trial engine (F4): plays the trial one simulated day at a time. Each day it charges that day's failed renewals,
// then the retries each route has due. The outcome model picks each result, the sale amount encodes it, and the
// gateway's answer is what the ledger records. Yields one event per day so the caller can stream and pause.

import { ruleFor } from "../declines";
import { declineAmount } from "../generator";
import { withRetry } from "../pool";
import { assignRoute, type Route } from "../trial";
import { newcombeInterval, twoProportionZTest } from "../results/stats";
import { isoDateOfDay } from "./calendar";
import { failuresForDay, type TrialCustomer } from "./failures";
import { isApproved, type SaleRequest, type TrialGateway } from "./gateway";
import { countDuplicates, type Ledger, type LedgerRecord } from "./ledger";
import { nextRetryDay, type History } from "./policies";
import { attemptSucceeds } from "./simulate";

// Sandbox calls the trial runs at once (seed and sync keep the 8 in CLAUDE.md). At 8, a full 695-sale run took 88 s on
// the sandbox; at 16, 58 s with no throttling, inside the 60-second fast-forward target. 429s back off (pool.ts).
// TRIAL_CONCURRENCY in .env overrides it (1–32), e.g. 8 if a sandbox starts throttling.
const DEFAULT_CONCURRENCY = 16;
export function trialConcurrency(): number {
  const n = Number(process.env.TRIAL_CONCURRENCY?.trim());
  return Number.isInteger(n) && n >= 1 && n <= 32 ? n : DEFAULT_CONCURRENCY;
}
const EARLY_STOP_MIN_CLOSED = 20; // closed invoices per route before the early-stop test is judged

export type RunSettings = {
  runId: string;
  seed: string; // the trial's assignment seed; also keys each outcome draw
  splitB: number;
  lengthDays: number; // enrollment: failures on these days join the trial
  windowDays: number; // each invoice is followed this long after its first failure
  startDate: string; // calendar date of simulated day 0
  earlyStop: { stopIfBWorse: boolean; maxComplaints: number };
  merchantAccountIds?: Partial<Record<Route, string>>;
};

type PerRoute = { A: number; B: number };
export type DayEvent = {
  type: "day";
  day: number;
  date: string;
  newFailures: PerRoute; // soft declines that joined the trial today
  excluded: PerRoute; // hard declines: charged once, never retried, left out of the comparison
  retries: PerRoute;
  collected: PerRoute;
  cumulative: { eligible: PerRoute; collected: PerRoute; retries: PerRoute; sales: number };
};
export type Audit = {
  ledgerDuplicates: number;
  gatewayDuplicates: number; // invoices the gateway shows collected more than once. Must be 0.
  invoicesOnBothRoutes: number;
  complaints: number; // sandbox data carries no complaints, so this stays 0
  maxComplaints: number;
  sales: number;
};
export type EngineEvent =
  | DayEvent
  | { type: "paused"; nextDay: number }
  | { type: "stopped"; day: number; rule: string; reason: string; audit: Audit }
  | { type: "complete"; audit: Audit };

export class EngineError extends Error {}

export type EngineDeps = {
  gateway: TrialGateway;
  customers: TrialCustomer[];
  ledger: Ledger;
  shouldPause?: (nextDay: number) => boolean; // checked before each day
  resume?: boolean; // continuing an earlier start of this run (pause, error or restart), even with an empty ledger
};

type Inv = { invoiceId: string; customer: TrialCustomer; route: Route; firstDay: number; h: History };

export const orderPrefix = (runId: string) => `sm-trial-${runId}-`;
export const totalDays = (s: Pick<RunSettings, "lengthDays" | "windowDays">) => s.lengthDays + s.windowDays;

// Runs work with bounded concurrency; after the first failure no new item starts, then the failure is thrown.
async function eachUntilError<T>(items: T[], fn: (item: T) => Promise<void>) {
  let next = 0;
  let failure: unknown = null;
  const workers = Array.from({ length: Math.min(trialConcurrency(), items.length) }, async () => {
    while (failure == null && next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        failure ??= err;
      }
    }
  });
  await Promise.all(workers);
  if (failure != null) throw failure;
}

export async function* runEngine(s: RunSettings, deps: EngineDeps): AsyncGenerator<EngineEvent> {
  const { gateway, ledger } = deps;
  const byId = new Map(deps.customers.map((c) => [c.customerId, c]));
  const prefix = orderPrefix(s.runId);
  const ctx = { startDate: s.startDate, windowDays: s.windowDays };
  const last = totalDays(s) - 1;
  const dayOfDate = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${s.startDate}T00:00:00Z`)) / 86_400_000);

  // Before sending anything, add any sale the gateway has that the ledger lacks (a crash between a sale and its
  // ledger line). The sandbox's duplicate check covers only 30 seconds, so a blind resend could collect twice.
  // A crash before the first ledger line leaves the ledger empty, so a resume always checks.
  if (ledger.records.length || deps.resume) {
    for (const t of await withRetry(() => gateway.findByOrderPrefix(prefix)))
      if (!ledger.hasTransaction(t.id))
        ledger.append({ ...t, runId: s.runId, route: t.custom.sm_route as Route, day: dayOfDate(t.custom.sm_attempt_at) });
  }

  // Rebuild every invoice from the ledger, so pause, resume and restart all continue from what really happened.
  const invoices = new Map<string, Inv>();
  const sorted = [...ledger.records].sort((a, b) => Number(a.custom.sm_attempt_no) - Number(b.custom.sm_attempt_no));
  for (const r of sorted) {
    const id = r.custom.sm_invoice_id;
    let inv = invoices.get(id);
    if (!inv) {
      const customer = byId.get(r.customerId ?? "");
      if (!customer) throw new EngineError(`The ledger names customer ${r.customerId}, who isn't in this trial.`);
      inv = { invoiceId: id, customer, route: r.route, firstDay: r.day, h: { firstDay: r.day, attempts: [] } };
      invoices.set(id, inv);
    }
    inv.h.attempts.push({ day: r.day, code: r.processorResponseCode, approved: isApproved(r) });
  }
  const lastDone = sorted.reduce((m, r) => Math.max(m, r.day), -1);
  // Days before the last one that has records are finished; that last day may be half done, so it runs again.
  const fromDay = Math.max(0, lastDone);

  async function charge(inv: Inv, day: number, amount: string) {
    const attemptNo = inv.h.attempts.length;
    const token = inv.customer.paymentMethodToken;
    if (!token) throw new EngineError(`Customer ${inv.customer.customerId} has no saved card.`);
    const req: SaleRequest = {
      paymentMethodToken: token,
      amount,
      orderId: `${prefix}${inv.invoiceId}-a${attemptNo}`,
      merchantAccountId: s.merchantAccountIds?.[inv.route],
      customFields: {
        sm_invoice_id: inv.invoiceId,
        sm_subscription_id: inv.customer.subscriptionId ?? "",
        sm_billing_date: isoDateOfDay(s.startDate, inv.firstDay),
        sm_attempt_at: isoDateOfDay(s.startDate, day),
        sm_attempt_no: String(attemptNo),
        sm_invoice_amount: inv.customer.price.toFixed(2),
        sm_route: inv.route,
      },
    };
    const res = await withRetry(() => gateway.sale(req));
    let t = res.transaction;
    if (res.outcome === "rejected" && /duplicate/i.test(res.message ?? "")) {
      // Our own earlier send went through: record that sale once instead of sending another.
      t = (await withRetry(() => gateway.findByOrderPrefix(req.orderId))).find((x) => x.orderId === req.orderId && isApproved(x)) ?? null;
      if (!t) throw new EngineError(`Braintree rejected ${req.orderId} as a duplicate, but no earlier sale was found.`);
    } else if (res.outcome === "rejected" || res.outcome === "invalid" || !t) {
      throw new EngineError(res.message || `Braintree didn't accept the sale for ${inv.invoiceId}.`);
    }
    const rec: LedgerRecord = { ...t, runId: s.runId, route: inv.route, day };
    ledger.append(rec);
    inv.h.attempts.push({ day, code: rec.processorResponseCode, approved: isApproved(rec) });
  }

  const soft = (inv: Inv) => inv.h.attempts.length > 0 && ruleFor(inv.h.attempts[0].code).type === "soft";
  const route0 = (): PerRoute => ({ A: 0, B: 0 });

  function audit(gatewayTxns: Parameters<typeof countDuplicates>[0]): Audit {
    const routesByCustomer = new Map<string, Set<Route>>();
    for (const r of ledger.records) {
      const key = r.customerId ?? "";
      let routes = routesByCustomer.get(key);
      if (!routes) routesByCustomer.set(key, (routes = new Set()));
      routes.add(r.route);
    }
    return {
      ledgerDuplicates: ledger.duplicateCollections(),
      gatewayDuplicates: countDuplicates(gatewayTxns),
      invoicesOnBothRoutes: [...routesByCustomer.values()].filter((x) => x.size > 1).length,
      complaints: 0,
      maxComplaints: s.earlyStop.maxComplaints,
      sales: ledger.records.length,
    };
  }

  for (let day = fromDay; day <= last; day++) {
    if (deps.shouldPause?.(day)) {
      yield { type: "paused", nextDay: day };
      return;
    }
    // Today's failed renewals (enrollment days only), then every retry that falls due today, in one pool.
    const work: { inv: Inv; amount: string; kind: "renewal" | "retry" }[] = [];
    if (day < s.lengthDays)
      for (const f of failuresForDay(deps.customers, s.startDate, day)) {
        if (invoices.has(f.invoiceId)) continue;
        const inv: Inv = { invoiceId: f.invoiceId, customer: f.customer, route: assignRoute(f.customer.customerId, s.seed, s.splitB), firstDay: day, h: { firstDay: day, attempts: [] } };
        invoices.set(f.invoiceId, inv);
        work.push({ inv, amount: declineAmount(Number(f.code)), kind: "renewal" });
      }
    for (const inv of invoices.values()) {
      if (!soft(inv) || inv.firstDay === day) continue;
      const next = nextRetryDay(inv.route, inv.h, ctx);
      if (next == null || next > day) continue;
      const ok = attemptSucceeds(s.seed, inv.invoiceId, inv.h.attempts.length, inv.h, s.startDate, day);
      const lastCode = inv.h.attempts[inv.h.attempts.length - 1].code;
      work.push({ inv, amount: ok ? inv.customer.price.toFixed(2) : declineAmount(Number(lastCode)), kind: "retry" });
    }
    // A renewal that never reached the ledger leaves an invoice with no attempts; drop it so a resume re-creates it.
    try {
      await eachUntilError(work, async (w) => {
        if (w.kind === "renewal" && w.inv.h.attempts.length > 0) return; // already charged before a restart
        await charge(w.inv, day, w.amount);
      });
    } finally {
      for (const [id, inv] of invoices) if (inv.h.attempts.length === 0) invoices.delete(id);
    }

    // The day's counts come from the ledger, so a day replayed after a pause or restart reports what really happened.
    const today = { newFailures: route0(), excluded: route0(), retries: route0(), collected: route0() };
    for (const r of ledger.records) {
      if (r.day !== day) continue;
      if (r.custom.sm_attempt_no === "0") (ruleFor(r.processorResponseCode).type === "soft" ? today.newFailures : today.excluded)[r.route]++;
      else {
        today.retries[r.route]++;
        if (isApproved(r)) today.collected[r.route]++;
      }
    }

    const cumulative = { eligible: route0(), collected: route0(), retries: route0(), sales: ledger.records.length };
    for (const inv of invoices.values()) {
      if (!soft(inv)) continue;
      cumulative.eligible[inv.route]++;
      cumulative.retries[inv.route] += inv.h.attempts.length - 1;
      if (inv.h.attempts.some((a) => a.approved)) cumulative.collected[inv.route]++;
    }
    yield { type: "day", day, date: isoDateOfDay(s.startDate, day), ...today, cumulative };

    // Early stop, judged only on invoices whose recovery window has closed: Route A retries sooner, so open
    // windows would favour it and trip a false stop.
    if (s.earlyStop.stopIfBWorse) {
      const closed = [...invoices.values()].filter((i) => soft(i) && day >= i.firstDay + s.windowDays);
      const n = { A: 0, B: 0 };
      const x = { A: 0, B: 0 };
      for (const i of closed) {
        n[i.route]++;
        if (i.h.attempts.some((a) => a.approved)) x[i.route]++;
      }
      const test = twoProportionZTest(x.A, n.A, x.B, n.B);
      const ci = newcombeInterval(x.A, n.A, x.B, n.B);
      // Checked every day, a handful of closed invoices trips a false stop about 1 run in 40; wait for a real sample.
      const enough = n.A >= EARLY_STOP_MIN_CLOSED && n.B >= EARLY_STOP_MIN_CLOSED;
      if (enough && test && ci && test.pValue < 0.05 && ci.high < 0) {
        yield {
          type: "stopped",
          day,
          rule: "Route B recovers significantly less than Route A",
          reason: `On closed invoices Route B recovered ${x.B} of ${n.B} and Route A ${x.A} of ${n.A} (p = ${test.pValue.toFixed(3)}).`,
          audit: audit(await withRetry(() => gateway.findByOrderPrefix(prefix))),
        };
        return;
      }
    }
  }
  yield { type: "complete", audit: audit(await withRetry(() => gateway.findByOrderPrefix(prefix))) };
}
