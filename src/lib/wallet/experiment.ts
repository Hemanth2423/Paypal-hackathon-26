// Wallet experiment (F8): does adding a PayPal button to the payment-update page recover more failed renewals?
// Control = card form only; treatment = the same page plus PayPal. Outcomes are simulated from the editable
// assumptions below (the sandbox can't tell us what real customers would do); the live PayPal flow is real.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { activeAssumptions } from "../assumptions";
import { ruleFor } from "../declines";
import { minDetectableUplift } from "../diagnostic";
import { newcombeInterval, twoProportionZTest } from "../results/stats";
import { decideVerdict } from "../results/verdict";
import { uniform } from "../run/calendar";
import { failuresForDay, trialCustomers } from "../run/failures";
import { assignRoute } from "../trial";
import { DEFAULT_WALLET_ASSUMPTIONS, FEES, WALLET_INFO, WALLET_READINESS, type WalletAssumptions } from "./info";

export { DEFAULT_WALLET_ASSUMPTIONS, FEES, WALLET_INFO, WALLET_READINESS, type WalletAssumptions };

const FILE = ".data/wallet.json";
export type WalletTrial = {
  id: string;
  seed: string;
  status: "draft" | "complete";
  lengthDays: number;
  windowDays: number;
  followUpDays: number;
  splitB: number;
  assumptions: WalletAssumptions;
  readiness: Record<keyof typeof WALLET_READINESS, boolean>;
  createdAt: string;
  ranAt: string | null;
};

export function newWalletTrial(): WalletTrial {
  return {
    id: `wallet-${randomUUID().slice(0, 8)}`,
    seed: randomUUID().slice(0, 12),
    status: "draft",
    lengthDays: 30,
    windowDays: 14,
    followUpDays: 30,
    splitB: 50,
    assumptions: DEFAULT_WALLET_ASSUMPTIONS,
    readiness: { consent: false, samePage: false, preRegistered: false, separate: false },
    createdAt: new Date().toISOString(),
    ranAt: null,
  };
}

export const loadWallet = (): WalletTrial | null => (existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as WalletTrial) : null);
export function saveWallet(t: WalletTrial) {
  mkdirSync(".data", { recursive: true });
  writeFileSync(FILE, JSON.stringify(t, null, 2));
}
export const deleteWallet = () => rmSync(FILE, { force: true });

export function applyWalletConfig(t: WalletTrial, c: Partial<WalletTrial>): WalletTrial {
  const num = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const a = { ...t.assumptions };
  for (const k of Object.keys(WALLET_INFO) as (keyof WalletAssumptions)[]) a[k] = +num(c.assumptions?.[k] ?? a[k], WALLET_INFO[k].min, WALLET_INFO[k].max, a[k]).toFixed(4);
  return {
    ...t,
    lengthDays: Math.round(num(c.lengthDays ?? t.lengthDays, 7, 60, 30)),
    splitB: Math.round(num(c.splitB ?? t.splitB, 10, 90, 50)),
    assumptions: a,
    readiness: { ...t.readiness, ...(c.readiness ?? {}) },
  };
}

export const missingReadiness = (t: WalletTrial) =>
  (Object.keys(WALLET_READINESS) as (keyof typeof WALLET_READINESS)[]).filter((k) => !t.readiness[k]).map((k) => WALLET_READINESS[k]);

export type WalletRow = {
  invoiceId: string;
  customerId: string;
  arm: "control" | "treatment";
  amount: number;
  reason: "hard_decline" | "retries_exhausted";
  completed: boolean;
  method: "card" | "paypal" | null;
  fee: number;
  refunded: boolean;
  net: number;
  nextRenewalPaid: boolean | null; // null = didn't recover, so no saved method to renew on
};

export function eligibleCustomers(customerIds: string[], t: WalletTrial, startDate: string) {
  const customers = trialCustomers(customerIds);
  const out: { invoiceId: string; customerId: string; amount: number; reason: WalletRow["reason"] }[] = [];
  const recovery = activeAssumptions().currentRecovery;
  for (let day = 0; day < t.lengthDays; day++)
    for (const f of failuresForDay(customers, startDate, day)) {
      const hard = ruleFor(f.code).type === "hard";
      // A soft decline only reaches the update page if the retries didn't recover it.
      if (!hard && uniform(t.seed, "retries-recovered", f.invoiceId) < recovery) continue;
      out.push({ invoiceId: f.invoiceId, customerId: f.customer.customerId, amount: f.customer.price, reason: hard ? "hard_decline" : "retries_exhausted" });
    }
  return out;
}

export function simulateWallet(customerIds: string[], t: WalletTrial, startDate: string): WalletRow[] {
  const a = t.assumptions;
  return eligibleCustomers(customerIds, t, startDate).map((e) => {
    const arm = assignRoute(e.customerId, t.seed, t.splitB) === "B" ? "treatment" : "control";
    const u = (tag: string) => uniform(t.seed, tag, e.invoiceId);
    const pComplete = Math.min(1, arm === "treatment" ? a.baselineCompletion * (1 + a.relativeLift) : a.baselineCompletion);
    const completed = u("complete") < pComplete;
    const method = !completed ? null : arm === "treatment" && u("method") < a.paypalShare ? "paypal" : "card";
    const fee = method ? +(e.amount * FEES[method].pct + FEES[method].fixed).toFixed(2) : 0;
    const refunded = completed && u("refund") < 0.02; // same rate in both groups (seed refundRate)
    const nextRenewalPaid = !completed ? null : u("next-renewal") >= (method === "paypal" ? a.nextFailWallet : a.nextFailCard);
    return { ...e, arm, completed, method, fee, refunded, net: completed ? +(e.amount - fee - (refunded ? e.amount : 0)).toFixed(2) : 0, nextRenewalPaid };
  });
}

function armStats(rows: WalletRow[]) {
  const n = rows.length;
  const recovered = rows.filter((r) => r.completed).length;
  const nextPaid = rows.filter((r) => r.nextRenewalPaid).length;
  const net = rows.reduce((s, r) => s + r.net, 0);
  return {
    assigned: n,
    recovered,
    recoveryRate: n ? recovered / n : null,
    paidWithPayPal: rows.filter((r) => r.method === "paypal").length,
    fees: +rows.reduce((s, r) => s + r.fee, 0).toFixed(2),
    refunds: rows.filter((r) => r.refunded).length,
    net: +net.toFixed(2),
    netPerAssigned: n ? net / n : null,
    nextRenewalPaid: nextPaid,
    nextRenewalPaidRate: n ? nextPaid / n : null,
    repeatFailureRate: recovered ? (recovered - nextPaid) / recovered : null,
  };
}

const LABELS = { paypal_wins: "Adding PayPal wins", current_wins: "Card-only page wins", inconclusive: "Inconclusive: extend the trial" } as const;

export function walletReport(rows: WalletRow[], t: WalletTrial) {
  const c = rows.filter((r) => r.arm === "control");
  const tr = rows.filter((r) => r.arm === "treatment");
  const A = armStats(c);
  const B = armStats(tr);
  const ci = newcombeInterval(A.recovered, A.assigned, B.recovered, B.assigned);
  const nextCi = newcombeInterval(A.nextRenewalPaid, A.assigned, B.nextRenewalPaid, B.assigned);
  const netDifference = A.netPerAssigned != null && B.netPerAssigned != null ? B.netPerAssigned - A.netPerAssigned : null;
  const v = decideVerdict({ ciLow: ci?.low ?? null, ciHigh: ci?.high ?? null, netDifference });
  return {
    trialId: t.id,
    groups: { control: A, treatment: B },
    uplift: A.recoveryRate != null && B.recoveryRate != null ? B.recoveryRate - A.recoveryRate : null,
    ci95: ci,
    pValue: twoProportionZTest(A.recovered, A.assigned, B.recovered, B.assigned)?.pValue ?? null,
    netDifference,
    verdict: { ...v, label: LABELS[v.verdict] },
    secondary: {
      uplift: A.nextRenewalPaidRate != null && B.nextRenewalPaidRate != null ? B.nextRenewalPaidRate - A.nextRenewalPaidRate : null,
      ci95: nextCi,
    },
    power: {
      perGroup: Math.min(A.assigned, B.assigned),
      minDetectableUplift: A.recoveryRate != null ? minDetectableUplift(A.recoveryRate, Math.min(A.assigned, B.assigned)) : null,
    },
    byReason: (["hard_decline", "retries_exhausted"] as const).map((reason) => ({
      reason,
      control: armStats(c.filter((r) => r.reason === reason)),
      treatment: armStats(tr.filter((r) => r.reason === reason)),
    })),
  };
}

export type WalletReport = ReturnType<typeof walletReport>;
