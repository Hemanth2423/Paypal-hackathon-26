// Builds the demo merchant's history as a plan of API calls. Pure and deterministic, so it can be tested
// without Braintree. The seed script turns this plan into real sandbox calls.

import type { SeedConfig } from "../../config/seed.config";

export const ID_PREFIX = "sm";
export const customerId = (i: number) => `${ID_PREFIX}-cust-${String(i).padStart(4, "0")}`;

export type PlannedAttempt = {
  attemptNo: number; // 0 = original renewal charge, 1+ = retries
  attemptAt: string; // simulated ISO date
  succeeds: boolean;
  declineCode: number | null; // set when the attempt fails
  sandboxAmount: string; // amount sent to the sandbox: decline test amount, or the invoice amount
};

export type PlannedInvoice = {
  invoiceId: string;
  customerId: string;
  planKey: string;
  amount: number;
  billingDate: string;
  firstDeclineCode: number;
  attempts: PlannedAttempt[];
  refunded: boolean;
};

export type PlannedCustomer = { id: string; planKey: string; cardNonce: string; renewalDay: number };

export type SeedPlan = { customers: PlannedCustomer[]; invoices: PlannedInvoice[]; historyStart: string; historyEnd: string };

// mulberry32: small seeded RNG
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T extends { weight: number }>(items: readonly T[], r: number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = r * total;
  for (const item of items) {
    x -= item.weight;
    if (x < 0) return item;
  }
  return items[items.length - 1];
}

const DAY = 86_400_000;

// "YYYY-MM-DD" → midday UTC on that day (the seed stores this so a resumed run builds the same plan).
export const anchorToDate = (day: string) => new Date(`${day}T12:00:00Z`);
const isoDate = (t: number) => new Date(t).toISOString().slice(0, 10);

// Sandbox rule: amounts 2000.00–2999.99 decline with code = amount; 3000.00 fails with code 3000.
export const declineAmount = (code: number) => `${code}.00`;

export function buildSeedPlan(cfg: SeedConfig, today: Date = new Date()): SeedPlan {
  const rand = rng(cfg.randomSeed);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const start = end - cfg.historyDays * DAY;

  const customers: PlannedCustomer[] = [];
  const invoices: PlannedInvoice[] = [];
  let invoiceSeq = 0;

  for (let i = 1; i <= cfg.customers; i++) {
    const plan = pick(cfg.plans, rand());
    const card = pick(cfg.cards, rand());
    const renewalDay = 1 + Math.floor(rand() * 28);
    const cust: PlannedCustomer = { id: customerId(i), planKey: plan.key, cardNonce: card.nonce, renewalDay };
    customers.push(cust);

    // Monthly renewals that fall inside the history window.
    for (let m = -4; m <= 0; m++) {
      const d = new Date(end);
      const billing = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, renewalDay);
      if (billing < start || billing >= end) continue;
      if (rand() >= cfg.renewalFailureRate) continue; // renewal succeeded: not part of the failure history

      const decline = pick(cfg.declineMix, rand());
      const attempts: PlannedAttempt[] = [
        { attemptNo: 0, attemptAt: isoDate(billing), succeeds: false, declineCode: decline.code, sandboxAmount: declineAmount(decline.code) },
      ];
      for (let k = 1; k <= cfg.existingProcess.maxRetries; k++) {
        const at = billing + k * cfg.existingProcess.retryEveryDays * DAY;
        if (at >= end) break; // retry hasn't happened yet
        const ok = rand() < decline.retrySuccess;
        attempts.push({
          attemptNo: k,
          attemptAt: isoDate(at),
          succeeds: ok,
          declineCode: ok ? null : decline.code,
          sandboxAmount: ok ? plan.price.toFixed(2) : declineAmount(decline.code),
        });
        if (ok) break;
      }
      const recovered = attempts[attempts.length - 1].succeeds;
      invoiceSeq++;
      invoices.push({
        invoiceId: `${ID_PREFIX}-inv-${String(invoiceSeq).padStart(5, "0")}`,
        customerId: cust.id,
        planKey: plan.key,
        amount: plan.price,
        billingDate: isoDate(billing),
        firstDeclineCode: decline.code,
        attempts,
        refunded: recovered && rand() < cfg.refundRate,
      });
    }
  }

  return { customers, invoices, historyStart: isoDate(start), historyEnd: isoDate(end - DAY) };
}
