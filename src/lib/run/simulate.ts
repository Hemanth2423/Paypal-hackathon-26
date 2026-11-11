// A trial played out from the model alone, with no gateway or ledger (F4). The verdict sweep uses it to check that the
// model's assumptions can reach a verdict, and the engine's tests check that a full run lands on the same numbers.

import { ruleFor } from "../declines";
import { assignRoute, type Route } from "../trial";
import { dayOfMonth, uniform } from "./calendar";
import { failuresForDay, type TrialCustomer } from "./failures";
import { successChance } from "./outcomes";
import { nextRetryDay, type History } from "./policies";

export type SimSettings = { seed: string; splitB: number; lengthDays: number; windowDays: number; startDate: string };
export type SimInvoice = { invoiceId: string; customerId: string; route: Route; code: string; amount: number; soft: boolean; recoveredDay: number | null };

// Whether an attempt clears. Keyed by the trial seed, invoice and attempt number, so engine and simulation agree.
export function attemptSucceeds(seed: string, invoiceId: string, attemptNo: number, h: History, startDate: string, day: number): boolean {
  const chance = successChance({
    firstCode: h.attempts[0].code,
    lastCode: h.attempts[h.attempts.length - 1].code,
    failedRetries: h.attempts.length - 1,
    dayOfMonth: dayOfMonth(startDate, day),
  });
  return uniform(seed, "outcome", invoiceId, String(attemptNo)) < chance;
}

export function simulateTrial(customers: TrialCustomer[], s: SimSettings): SimInvoice[] {
  const ctx = { startDate: s.startDate, windowDays: s.windowDays };
  const open: { inv: SimInvoice; h: History }[] = [];
  const all: SimInvoice[] = [];
  for (let day = 0; day < s.lengthDays + s.windowDays; day++) {
    if (day < s.lengthDays)
      for (const f of failuresForDay(customers, s.startDate, day)) {
        const soft = ruleFor(f.code).type === "soft";
        const inv: SimInvoice = {
          invoiceId: f.invoiceId,
          customerId: f.customer.customerId,
          route: assignRoute(f.customer.customerId, s.seed, s.splitB),
          code: f.code,
          amount: f.customer.price,
          soft,
          recoveredDay: null,
        };
        all.push(inv);
        if (soft) open.push({ inv, h: { firstDay: day, attempts: [{ day, code: f.code, approved: false }] } });
      }
    for (const o of open) {
      const next = nextRetryDay(o.inv.route, o.h, ctx);
      if (next == null || next > day) continue;
      const approved = attemptSucceeds(s.seed, o.inv.invoiceId, o.h.attempts.length, o.h, s.startDate, day);
      o.h.attempts.push({ day, code: o.h.attempts[0].code, approved });
      if (approved) o.inv.recoveredDay = day;
    }
  }
  return all;
}
