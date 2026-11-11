// Trial setup (F3): sticky route assignment, group balance, power estimate, readiness gate.
// The saved trial (.data/trial.json) is the handoff to F4 — see TechSpec §5 "Trial handoff".

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { minDetectableUplift, recoveryRate, type Invoice } from "./diagnostic";

const TRIAL_FILE = ".data/trial.json";
export const BALANCE_TOLERANCE = 0.05; // 5 percentage points

export type Route = "A" | "B";

export type Trial = {
  id: string;
  seed: string;
  status: "draft" | "running";
  lengthDays: number; // enrollment period: failures in these days join the trial
  recoveryWindowDays: number; // each failure is followed this long after it first fails
  splitB: number; // % of customers on Route B (PayPal)
  earlyStop: { stopIfBWorse: boolean; maxComplaints: number };
  readiness: { consent: boolean; dataScope: boolean; earlyStop: boolean; oneRoutePerInvoice: boolean };
  createdAt: string;
  startedAt: string | null;
};

export const READINESS_LABELS: Record<keyof Trial["readiness"], string> = {
  consent: "Merchant consent and trial terms accepted",
  dataScope: "Data-access scope confirmed (read payments, run retries on Route B)",
  earlyStop: "Early-stop rules reviewed",
  oneRoutePerInvoice: "Each invoice is retried by exactly one route",
};

export function newTrial(): Trial {
  return {
    id: `trial-${randomUUID().slice(0, 8)}`,
    seed: randomUUID().slice(0, 12),
    status: "draft",
    lengthDays: 21,
    recoveryWindowDays: 14,
    splitB: 50,
    earlyStop: { stopIfBWorse: true, maxComplaints: 5 },
    readiness: { consent: false, dataScope: false, earlyStop: false, oneRoutePerInvoice: false },
    createdAt: new Date().toISOString(),
    startedAt: null,
  };
}

// sha256(customerId + seed) mod 100 < splitB → Route B. Never stored, always reproducible.
export function assignRoute(customerId: string, seed: string, splitB: number): Route {
  const bucket = parseInt(createHash("sha256").update(customerId + seed).digest("hex").slice(0, 8), 16) % 100;
  return bucket < splitB ? "B" : "A";
}

export function loadTrial(): Trial | null {
  return existsSync(TRIAL_FILE) ? (JSON.parse(readFileSync(TRIAL_FILE, "utf8")) as Trial) : null;
}

export function saveTrial(t: Trial) {
  mkdirSync(".data", { recursive: true });
  writeFileSync(TRIAL_FILE, JSON.stringify(t, null, 2));
}

export function deleteTrial() {
  rmSync(TRIAL_FILE, { force: true });
}

// Keeps settings inside sane bounds; readiness and status are never set through config updates.
export function applyConfig(t: Trial, c: Partial<Trial>): Trial {
  const clamp = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  return {
    ...t,
    lengthDays: clamp(c.lengthDays ?? t.lengthDays, 7, 60, 21),
    recoveryWindowDays: clamp(c.recoveryWindowDays ?? t.recoveryWindowDays, 7, 30, 14),
    splitB: clamp(c.splitB ?? t.splitB, 10, 90, 50),
    earlyStop: {
      stopIfBWorse: c.earlyStop?.stopIfBWorse ?? t.earlyStop.stopIfBWorse,
      maxComplaints: clamp(c.earlyStop?.maxComplaints ?? t.earlyStop.maxComplaints, 0, 1000, 5),
    },
    readiness: { ...t.readiness, ...(c.readiness ?? {}) },
  };
}

export function uncheckedReadiness(t: Trial): string[] {
  return (Object.keys(READINESS_LABELS) as (keyof Trial["readiness"])[]).filter((k) => !t.readiness[k]).map((k) => READINESS_LABELS[k]);
}

type GroupStats = { customers: number; invoices: number; amount: number; recoveryRate: number | null; declineMix: Record<string, number>; planMix: Record<string, number> };

function stats(customers: string[], invoices: Invoice[]): GroupStats {
  const share = (key: (i: Invoice) => string) => {
    const m: Record<string, number> = {};
    for (const i of invoices) m[key(i)] = (m[key(i)] ?? 0) + 1 / invoices.length;
    return m;
  };
  return {
    customers: customers.length,
    invoices: invoices.length,
    amount: +invoices.reduce((s, i) => s + i.amount, 0).toFixed(2),
    recoveryRate: recoveryRate(invoices),
    declineMix: share((i) => i.firstCode),
    planMix: share((i) => i.planId),
  };
}

// Balance is checked on each route's failed-renewal history: soft declines only (hard ones are excluded from the trial).
export function preview(t: Trial, customerIds: string[], invoices: Invoice[], softPerWeek: number) {
  const routeOf = new Map(customerIds.map((c) => [c, assignRoute(c, t.seed, t.splitB)]));
  const eligible = invoices.filter((i) => i.declineType === "soft");
  const hard = invoices.filter((i) => i.declineType === "hard");
  const cust = (r: Route) => customerIds.filter((c) => routeOf.get(c) === r);
  const inv = (r: Route) => eligible.filter((i) => routeOf.get(i.customerId) === r);
  const A = stats(cust("A"), inv("A"));
  const B = stats(cust("B"), inv("B"));

  const warnings: string[] = [];
  const expectedB = t.splitB / 100;
  const actualB = customerIds.length ? B.customers / customerIds.length : 0;
  if (Math.abs(actualB - expectedB) > BALANCE_TOLERANCE)
    warnings.push(`Route B has ${(actualB * 100).toFixed(1)}% of customers vs. the ${t.splitB}% target.`);
  for (const [dim, a, b] of [["Decline", A.declineMix, B.declineMix], ["Plan", A.planMix, B.planMix]] as const) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const diff = Math.abs((a[k] ?? 0) - (b[k] ?? 0));
      if (diff > BALANCE_TOLERANCE) warnings.push(`${dim} mix differs on ${k}: ${((a[k] ?? 0) * 100).toFixed(1)}% vs ${((b[k] ?? 0) * 100).toFixed(1)}%.`);
    }
  }

  const excludedByCode = new Map<string, { code: string; name: string; count: number; amount: number }>();
  for (const i of hard) {
    const e = excludedByCode.get(i.firstCode) ?? { code: i.firstCode, name: i.declineName, count: 0, amount: 0 };
    e.count++;
    e.amount = +(e.amount + i.amount).toFixed(2);
    excludedByCode.set(i.firstCode, e);
  }

  const expected = softPerWeek * (t.lengthDays / 7);
  const nB = Math.floor(expected * expectedB);
  const nA = Math.floor(expected - nB);
  const baseline = A.recoveryRate ?? recoveryRate(eligible) ?? 0.5;
  return {
    groups: { A, B },
    warnings,
    excluded: [...excludedByCode.values()].sort((x, y) => y.count - x.count),
    power: {
      expectedEligible: Math.round(expected),
      perGroup: { A: nA, B: nB },
      baselineRate: baseline,
      minDetectableUplift: minDetectableUplift(baseline, Math.min(nA, nB)),
      resultsAfterDays: t.lengthDays + t.recoveryWindowDays,
    },
  };
}

export type TrialPreview = ReturnType<typeof preview>;
