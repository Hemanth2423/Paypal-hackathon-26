// Results report (F5): the trial's ledger, read through the Diagnostic's own invoice model, compared route by route.
// Only a finished or early-stopped run gets a verdict; a run still going returns progress only.

import { applyFilters, buildInvoices, requiredPerArm, toCsv, type Invoice, type TableFilter } from "../diagnostic";
import { ruleFor } from "../declines";
import type { Route } from "../trial";
import { isoDateOfDay } from "../run/calendar";
import type { GatewayKind } from "../run/gateway";
import type { LedgerRecord } from "../run/ledger";
import { newcombeInterval, twoProportionZTest, type Interval } from "./stats";
import { decideVerdict, type VerdictResult } from "./verdict";

export type RunInfo = {
  status: string;
  startDate: string;
  lengthDays: number;
  windowDays: number;
  nextDay: number; // first day not yet finished
  gateway: GatewayKind | null;
  stop: { day: number; rule: string; reason: string; discarded?: boolean } | null;
};

export type RouteMetrics = {
  eligible: number; // soft first declines whose recovery window has closed
  recovered: number;
  recoveryRate: number | null;
  recoveredAmount: number;
  costsAndFees: number; // excess-retry fees (no per-retry cost, matching the Diagnostic)
  refunds: number;
  net: number; // recovered − costs and fees − refunds
  netPerEligible: number | null;
  savedSubscriptions: number; // recovered and not refunded
  retries: number;
  inWindow: number; // soft declines whose window is still open: not counted yet
};

export type Comparison = {
  routes: Record<Route, RouteMetrics>;
  uplift: number | null; // Route B rate − Route A rate (0.05 = 5 pp)
  relativeUplift: number | null; // uplift ÷ Route A rate
  ci95: Interval | null;
  pValue: number | null;
  netPerInvoiceDifference: number | null; // net $ per eligible invoice, B − A: what the verdict reads
};

export type ReasonRow = Comparison & { code: string; label: string };

export type FinalReport = Comparison & {
  kind: "final";
  asOf: string;
  dataSource: string;
  netDifferenceScaled: number | null; // per-invoice difference × all eligible invoices: the headline $
  verdict: VerdictResult;
  settleSample: number | null; // invoices per route that would detect the observed uplift (inconclusive only)
  byReason: ReasonRow[];
  excluded: { code: string; name: string; count: number; amount: number }[];
  stoppedEarly: { day: number; rule: string; reason: string } | null;
  invoices: Invoice[];
};
export type ProgressReport = { kind: "progress"; day: number; totalDays: number; dataSource: string; invoices: Invoice[] };
export type Report = FinalReport | ProgressReport;

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));
export const dataSourceOf = (gateway: GatewayKind | null) => (gateway === "standin" ? "standin" : "braintree_sandbox");

// An invoice counts once its recovery window has closed, recovered or not. (The Diagnostic's "in_window" status
// marks only unrecovered invoices, so counting "not in_window" would let an early stop count open-window recoveries.)
type Closed = (i: Invoice) => boolean;

function metrics(all: Invoice[], route: Route, closed: Closed): RouteMetrics {
  const mine = all.filter((i) => i.route === route && i.declineType === "soft");
  const counted = mine.filter(closed);
  const won = counted.filter((i) => i.status === "recovered");
  const net = sum(counted.map((i) => i.netRecovered));
  return {
    eligible: counted.length,
    recovered: won.length,
    recoveryRate: counted.length ? won.length / counted.length : null,
    recoveredAmount: sum(counted.map((i) => i.recoveredAmount)),
    costsAndFees: sum(counted.map((i) => i.excessFees)),
    refunds: sum(counted.map((i) => i.refundedAmount)),
    net,
    netPerEligible: counted.length ? net / counted.length : null,
    savedSubscriptions: won.filter((i) => i.refundedAmount === 0).length,
    retries: counted.reduce((s, i) => s + i.attempts.length - 1, 0),
    inWindow: mine.length - counted.length,
  };
}

function compare(invoices: Invoice[], closed: Closed): Comparison {
  const A = metrics(invoices, "A", closed);
  const B = metrics(invoices, "B", closed);
  const uplift = A.recoveryRate != null && B.recoveryRate != null ? B.recoveryRate - A.recoveryRate : null;
  return {
    routes: { A, B },
    uplift,
    relativeUplift: uplift != null && A.recoveryRate ? uplift / A.recoveryRate : null,
    ci95: newcombeInterval(A.recovered, A.eligible, B.recovered, B.eligible),
    pValue: twoProportionZTest(A.recovered, A.eligible, B.recovered, B.eligible)?.pValue ?? null,
    netPerInvoiceDifference: A.netPerEligible != null && B.netPerEligible != null ? r2(B.netPerEligible - A.netPerEligible) : null,
  };
}

export function buildReport(records: LedgerRecord[], run: RunInfo): Report {
  const dataSource = dataSourceOf(run.gateway);
  const lastDone = Math.max(0, run.nextDay - 1);
  const asOf = isoDateOfDay(run.startDate, lastDone);
  const invoices = buildInvoices(records, asOf, run.windowDays);
  const totalDays = run.lengthDays + run.windowDays;
  // Only a completed run, or one ended by an early-stop rule, gets a verdict; a discarded trial never finished.
  const finished = run.status === "complete" || (run.status === "stopped" && !run.stop?.discarded);
  if (!finished) return { kind: "progress", day: run.nextDay, totalDays, dataSource, invoices };

  const closedBy = Date.parse(`${asOf}T00:00:00Z`);
  const closed: Closed = (i) => Date.parse(`${i.billingDate}T00:00:00Z`) + run.windowDays * 86_400_000 <= closedBy;
  const c = compare(invoices, closed);
  const verdict = decideVerdict({ ciLow: c.ci95?.low ?? null, ciHigh: c.ci95?.high ?? null, netDifference: c.netPerInvoiceDifference });
  const { A } = c.routes;
  const settleSample =
    verdict.verdict === "inconclusive" && A.recoveryRate != null && c.uplift != null && c.uplift > 0 ? requiredPerArm(A.recoveryRate, c.uplift) : null;

  const codes = [...new Set(invoices.filter((i) => i.declineType === "soft").map((i) => i.firstCode))];
  const byReason = codes
    .map((code) => ({ code, label: `${code} · ${ruleFor(code).name}`, ...compare(invoices.filter((i) => i.firstCode === code), closed) }))
    .sort((a, b) => (b.uplift ?? -Infinity) - (a.uplift ?? -Infinity));

  const excluded = new Map<string, { code: string; name: string; count: number; amount: number }>();
  for (const i of invoices.filter((x) => x.declineType === "hard")) {
    const e = excluded.get(i.firstCode) ?? { code: i.firstCode, name: i.declineName, count: 0, amount: 0 };
    e.count++;
    e.amount = r2(e.amount + i.amount);
    excluded.set(i.firstCode, e);
  }

  return {
    kind: "final",
    asOf: isoDateOfDay(run.startDate, lastDone),
    dataSource,
    ...c,
    netDifferenceScaled: c.netPerInvoiceDifference != null ? r2(c.netPerInvoiceDifference * (c.routes.A.eligible + c.routes.B.eligible)) : null,
    verdict,
    settleSample,
    byReason,
    excluded: [...excluded.values()].sort((a, b) => b.count - a.count),
    stoppedEarly: run.status === "stopped" ? run.stop : null,
    invoices,
  };
}

export type ResultsFilter = { route?: string; reason?: string; status?: string };

export function filterInvoices(r: Report, f: ResultsFilter): Invoice[] {
  return applyFilters(r.invoices, { reason: f.reason, status: f.status } as TableFilter).filter((i) => !f.route || i.route === f.route);
}

// The results CSV: the Diagnostic's exporter and columns, with the route filled in.
export const reportCsv = (r: Report, f: ResultsFilter) => toCsv(filterInvoices(r, f), new Date().toISOString(), r.dataSource);
