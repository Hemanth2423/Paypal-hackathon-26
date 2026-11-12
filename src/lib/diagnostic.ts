// Leak Diagnostic engine (F2): turns the synced Braintree transactions into invoices, dashboard sections and CSV.
// Pure functions over the sync cache, so the dashboard, CSV and AI analyst all read the same numbers.

import { existsSync, readFileSync, statSync } from "node:fs";
import { seedConfig } from "../../config/seed.config";
import { EXCESS_RETRY_FEE, ruleFor } from "./declines";
import type { SyncCache, SyncedTransaction } from "./sync";

const CACHE_FILE = ".data/sync-cache.json";
const RECOVERY_WINDOW_DAYS = 14;
const DAY = 86_400_000;
const APPROVED = new Set(["settled", "settling", "submitted_for_settlement", "authorized"]);

export type Attempt = { txnId: string; attemptNo: number; attemptAt: string; code: string; text: string; status: string; approved: boolean };

export type Invoice = {
  invoiceId: string;
  subscriptionId: string;
  customerId: string;
  planId: string;
  amount: number;
  currency: string;
  billingDate: string;
  merchantAccountId: string;
  cardBrand: string;
  cardType: string;
  cardLast4: string;
  firstCode: string;
  firstText: string;
  declineName: string;
  declineType: "soft" | "hard";
  networkCategory: string;
  attempts: Attempt[];
  retriesOverCap: number;
  excessFees: number;
  status: "recovered" | "unrecovered" | "in_window";
  recoveredAt: string | null;
  daysToRecover: number | null;
  recoveredAmount: number;
  refundedAmount: number;
  netRecovered: number;
  route?: "A" | "B"; // trial invoices only (sm_route)
};

export type Filters = { from?: string; to?: string; reason?: string; brand?: string; plan?: string };
export type TableFilter = { reason?: string; type?: string; status?: string };

const planByPrice = new Map(seedConfig.plans.map((p) => [p.price.toFixed(2), p.key]));

// The sync cache is large (~23 MB at 10K customers): parse it once and reuse it until the next sync rewrites the file.
let cacheMemo: { mtime: number; cache: SyncCache } | null = null;
export function loadCache(): SyncCache | null {
  if (!existsSync(CACHE_FILE)) return null;
  const mtime = statSync(CACHE_FILE).mtimeMs;
  if (cacheMemo?.mtime === mtime) return cacheMemo.cache;
  cacheMemo = { mtime, cache: JSON.parse(readFileSync(CACHE_FILE, "utf8")) as SyncCache };
  return cacheMemo.cache;
}

// Built invoices per transaction list (one per sync) and settings; callers treat them as read-only.
const invoiceMemo = new WeakMap<object, Map<string, Invoice[]>>();

// windowDays: the recovery window. The Diagnostic uses 14; a trial passes its own setting.
export function buildInvoices(txns: SyncedTransaction[], asOf: string, windowDays = RECOVERY_WINDOW_DAYS): Invoice[] {
  const key = `${asOf}|${windowDays}|${txns.length}`; // length: the trial ledger list grows during a run
  const byTxns = invoiceMemo.get(txns) ?? new Map<string, Invoice[]>();
  const hit = byTxns.get(key);
  if (hit) return hit;
  const built = buildInvoicesUncached(txns, asOf, windowDays);
  byTxns.set(key, built);
  invoiceMemo.set(txns, byTxns);
  return built;
}

function buildInvoicesUncached(txns: SyncedTransaction[], asOf: string, windowDays: number): Invoice[] {
  const groups = new Map<string, SyncedTransaction[]>();
  for (const t of txns) {
    const id = t.custom.sm_invoice_id;
    if (!id) continue;
    (groups.get(id) ?? groups.set(id, []).get(id)!).push(t);
  }
  const asOfMs = Date.parse(asOf);
  const out: Invoice[] = [];
  for (const [invoiceId, list] of groups) {
    list.sort((a, b) => Number(a.custom.sm_attempt_no) - Number(b.custom.sm_attempt_no));
    const first = list[0];
    const rule = ruleFor(first.processorResponseCode, first.processorResponseText);
    const attempts: Attempt[] = list.map((t) => ({
      txnId: t.id,
      attemptNo: Number(t.custom.sm_attempt_no),
      attemptAt: t.custom.sm_attempt_at,
      code: t.processorResponseCode,
      text: t.processorResponseText,
      status: t.status,
      approved: APPROVED.has(t.status),
    }));
    const win = attempts.find((a) => a.approved);
    const winTxn = win ? list.find((t) => t.id === win.txnId)! : null;
    const amount = Number(first.custom.sm_invoice_amount);
    const retries = attempts.length - 1;
    const retriesOverCap = rule.retryCap == null ? 0 : Math.max(0, retries - rule.retryCap);
    const excessFees = +(retriesOverCap * EXCESS_RETRY_FEE).toFixed(2);
    const recoveredAmount = win ? amount : 0;
    const refundedAmount = winTxn?.refunded ? amount : 0;
    const billing = first.custom.sm_billing_date;
    const inWindow = !win && Date.parse(billing) + windowDays * DAY > asOfMs;
    out.push({
      invoiceId,
      subscriptionId: first.custom.sm_subscription_id,
      customerId: first.customerId ?? "",
      planId: planByPrice.get(amount.toFixed(2)) ?? "unknown",
      amount,
      currency: first.currency,
      billingDate: billing,
      merchantAccountId: first.merchantAccountId,
      cardBrand: first.cardBrand ?? "",
      cardType: first.cardDebit === "Yes" ? "debit" : first.cardDebit === "No" ? "credit" : "unknown",
      cardLast4: first.cardLast4 ?? "",
      firstCode: rule.code,
      firstText: first.processorResponseText,
      declineName: rule.name,
      declineType: rule.type,
      networkCategory: rule.networkCategory,
      attempts,
      retriesOverCap,
      excessFees,
      status: win ? "recovered" : inWindow ? "in_window" : "unrecovered",
      recoveredAt: win?.attemptAt ?? null,
      daysToRecover: win ? Math.round((Date.parse(win.attemptAt) - Date.parse(billing)) / DAY) : null,
      recoveredAmount,
      refundedAmount,
      netRecovered: +(recoveredAmount - refundedAmount - excessFees).toFixed(2),
      ...(first.custom.sm_route === "A" || first.custom.sm_route === "B" ? { route: first.custom.sm_route } : {}),
    });
  }
  return out.sort((a, b) => b.billingDate.localeCompare(a.billingDate) || a.invoiceId.localeCompare(b.invoiceId));
}

export function applyFilters(rows: Invoice[], f: Filters & TableFilter): Invoice[] {
  return rows.filter(
    (r) =>
      (!f.from || r.billingDate >= f.from) &&
      (!f.to || r.billingDate <= f.to) &&
      (!f.reason || r.firstCode === f.reason) &&
      (!f.brand || r.cardBrand === f.brand) &&
      (!f.plan || r.planId === f.plan) &&
      (!f.type || r.declineType === f.type) &&
      (!f.status || r.status === f.status),
  );
}

const sum = (xs: number[]) => +xs.reduce((s, x) => s + x, 0).toFixed(2);

// Recovery rate counts only decided invoices (recovery window closed or recovered).
export function recoveryRate(rows: Invoice[]): number | null {
  const decided = rows.filter((r) => r.status !== "in_window");
  return decided.length ? decided.filter((r) => r.status === "recovered").length / decided.length : null;
}

// Two-proportion test sample size per arm (α = 0.05 two-sided, power 0.8).
export function requiredPerArm(p1: number, d: number): number {
  const p2 = Math.min(0.999, p1 + d);
  const pbar = (p1 + p2) / 2;
  const n = (1.96 * Math.sqrt(2 * pbar * (1 - pbar)) + 0.8416 * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / d ** 2;
  return Math.ceil(n);
}

// Smallest uplift (in 0.5 pp steps) detectable with n invoices per arm; null if none up to +50 pp.
export function minDetectableUplift(p: number, nPerArm: number): number | null {
  for (let d = 0.005; d <= 0.5 && p + d < 1; d += 0.005) if (requiredPerArm(p, d) <= nPerArm) return +d.toFixed(3);
  return null;
}

function kpis(rows: Invoice[]) {
  const soft = rows.filter((r) => r.declineType === "soft");
  return {
    failedRevenue: sum(rows.map((r) => r.amount)),
    recoverableRevenue: sum(soft.map((r) => r.amount)),
    recoveryRate: recoveryRate(soft),
    hardRevenue: sum(rows.filter((r) => r.declineType === "hard").map((r) => r.amount)),
  };
}

export function computeDiagnostic(all: Invoice[], f: Filters, asOf: string, trialWeeks = 3) {
  const rows = applyFilters(all, f);
  const end = Date.parse(asOf);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const last30 = rows.filter((r) => r.billingDate > iso(end - 30 * DAY));
  const prior30 = rows.filter((r) => r.billingDate > iso(end - 60 * DAY) && r.billingDate <= iso(end - 30 * DAY));

  const total = sum(rows.map((r) => r.amount));
  const reasons = [...new Set(rows.map((r) => r.firstCode))].map((code) => {
    const list = rows.filter((r) => r.firstCode === code);
    const amount = sum(list.map((r) => r.amount));
    return {
      code,
      name: list[0].declineName,
      type: list[0].declineType,
      count: list.length,
      amount,
      share: total ? amount / total : 0,
      recoveryRate: recoveryRate(list),
    };
  });
  reasons.sort((a, b) => b.amount - a.amount);

  const soft = rows.filter((r) => r.declineType === "soft");
  const hard = rows.filter((r) => r.declineType === "hard");
  const softRate = recoveryRate(soft);
  const days = rows.length ? Math.max(1, (Date.parse(rows[0].billingDate) - Date.parse(rows[rows.length - 1].billingDate)) / DAY + 1) : 1;
  const unrecoveredSoft = sum(soft.filter((r) => r.status === "unrecovered").map((r) => r.amount));
  const softPerWeek = soft.length / (days / 7);
  const nPerArm = Math.floor((softPerWeek * trialWeeks) / 2);

  return {
    asOf,
    rowCount: rows.length,
    kpis: { ...kpis(rows), last30: kpis(last30), prior30: kpis(prior30) },
    reasons,
    split: {
      soft: { count: soft.length, amount: sum(soft.map((r) => r.amount)) },
      hard: { count: hard.length, amount: sum(hard.map((r) => r.amount)) },
    },
    overallRecoveryRate: recoveryRate(rows),
    waste: {
      hardRetries: sum(hard.map((r) => r.attempts.length - 1)),
      hardInvoicesRetried: hard.filter((r) => r.attempts.length > 1).length,
      retriesOverCap: sum(rows.map((r) => r.retriesOverCap)),
      excessFees: sum(rows.map((r) => r.excessFees)),
    },
    stakes: {
      recoverableMrrPerMonth: +((unrecoveredSoft / days) * 30).toFixed(2),
      trialWeeks,
      eligiblePerWeek: +softPerWeek.toFixed(1),
      nPerArm,
      baselineRate: softRate,
      minDetectableUplift: softRate == null ? null : minDetectableUplift(softRate, nPerArm),
    },
    rows,
  };
}

export type Diagnostic = ReturnType<typeof computeDiagnostic>;

export const CSV_COLUMNS = [
  "invoice_id", "subscription_id", "customer_id", "plan_id", "route", "merchant_account_id",
  "amount", "currency", "billing_date_simulated", "first_failed_at", "braintree_transaction_ids",
  "card_brand", "card_type", "card_last4",
  "processor_response_code", "processor_response_text", "merchant_advice_code", "decline_type", "network_retry_category",
  "attempt_count", "first_attempt_at", "last_attempt_at", "attempts_over_network_limit", "estimated_excess_fees",
  "status", "recovered_at", "days_to_recover", "recovered_amount", "refunded_amount", "net_recovered_amount",
  "subscription_status_end", "data_source", "outcome_simulated", "exported_at",
] as const;

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// dataSource names where the rows came from: "braintree_sandbox", or "standin" for a stand-in trial run.
export function toCsv(rows: Invoice[], exportedAt = new Date().toISOString(), dataSource = "braintree_sandbox"): string {
  const lines = rows.map((r) =>
    [
      r.invoiceId, r.subscriptionId, r.customerId, r.planId, r.route ?? "current", r.merchantAccountId,
      r.amount.toFixed(2), r.currency, r.billingDate, r.attempts[0].attemptAt, r.attempts.map((a) => a.txnId).join(" "),
      r.cardBrand, r.cardType, r.cardLast4,
      r.firstCode, r.firstText, "", r.declineType, r.networkCategory,
      r.attempts.length, r.attempts[0].attemptAt, r.attempts[r.attempts.length - 1].attemptAt, r.retriesOverCap, r.excessFees.toFixed(2),
      r.status, r.recoveredAt ?? "", r.daysToRecover ?? "", r.recoveredAmount.toFixed(2), r.refundedAmount.toFixed(2), r.netRecovered.toFixed(2),
      "", dataSource, "true", exportedAt,
    ].map(esc).join(","),
  );
  return "﻿" + [CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}

export function parseFilters(sp: URLSearchParams): Filters & TableFilter {
  const get = (k: string) => sp.get(k) || undefined;
  return { from: get("from"), to: get("to"), reason: get("reason"), brand: get("brand"), plan: get("plan"), type: get("type"), status: get("status") };
}
