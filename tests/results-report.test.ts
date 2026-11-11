import { test } from "node:test";
import assert from "node:assert/strict";
import { CSV_COLUMNS } from "../src/lib/diagnostic";
import { buildReport, reportCsv, type RunInfo } from "../src/lib/results/report";
import type { LedgerRecord } from "../src/lib/run/ledger";

const START = "2026-11-01";
const date = (day: number) => new Date(Date.parse(`${START}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
const finished: RunInfo = { status: "complete", startDate: START, lengthDays: 21, windowDays: 14, nextDay: 35, gateway: "braintree", stop: null };

let seq = 0;
function attempt(inv: string, route: "A" | "B", amount: number, firstDay: number, n: number, day: number, outcome: "declined" | "collected", code: string): LedgerRecord {
  return {
    id: `t${++seq}`,
    orderId: `sm-trial-r1-${inv}-a${n}`,
    status: outcome === "collected" ? "submitted_for_settlement" : code === "3000" ? "failed" : "processor_declined",
    amount: outcome === "collected" ? amount.toFixed(2) : `${code}.00`,
    currency: "USD",
    processorResponseCode: outcome === "collected" ? "1000" : code,
    processorResponseText: "",
    merchantAccountId: "ucb",
    customerId: `cust-${inv}`,
    cardBrand: "Visa",
    cardDebit: "No",
    cardLast4: "1111",
    refunded: false,
    createdAt: "2026-11-11T00:00:00Z",
    custom: {
      sm_invoice_id: inv,
      sm_subscription_id: `sub-${inv}`,
      sm_billing_date: date(firstDay),
      sm_attempt_at: date(day),
      sm_attempt_no: String(n),
      sm_invoice_amount: amount.toFixed(2),
      sm_route: route,
    },
    runId: "r1",
    route,
    day,
  };
}
// An invoice that fails on firstDay with `code`, then is either collected on day firstDay+3 or never.
const invoice = (inv: string, route: "A" | "B", amount: number, recovered: boolean, code = "2001", firstDay = 0) => [
  attempt(inv, route, amount, firstDay, 0, firstDay, "declined", code),
  attempt(inv, route, amount, firstDay, 1, firstDay + 3, recovered ? "collected" : "declined", code),
];

// Route A: 2 of 4 recovered ($29 + $29). Route B: 3 of 4 ($99 + $29 + $29).
const ledger = [
  ...invoice("a1", "A", 29, true),
  ...invoice("a2", "A", 29, true, "2000"),
  ...invoice("a3", "A", 99, false),
  ...invoice("a4", "A", 29, false, "2000"),
  ...invoice("b1", "B", 99, true),
  ...invoice("b2", "B", 29, true),
  ...invoice("b3", "B", 29, true, "2000"),
  ...invoice("b4", "B", 299, false, "2000"),
  attempt("h1", "A", 99, 2, 0, 2, "declined", "2004"), // hard: excluded
  attempt("h2", "B", 29, 3, 0, 3, "declined", "2004"),
];

test("side-by-side metrics: rates, recovered $ and uplift", () => {
  const r = buildReport(ledger, finished);
  assert.equal(r.kind, "final");
  if (r.kind !== "final") return;
  assert.equal(r.routes.A.eligible, 4);
  assert.equal(r.routes.A.recoveryRate, 0.5);
  assert.equal(r.routes.B.recoveryRate, 0.75);
  assert.equal(r.routes.A.recoveredAmount, 58);
  assert.equal(r.routes.B.recoveredAmount, 157);
  assert.equal(r.uplift!.toFixed(4), "0.2500");
  assert.equal(r.relativeUplift!.toFixed(4), "0.5000");
  assert.equal(r.routes.B.savedSubscriptions, 3);
});

test("net $: +$24.75 per eligible invoice, +$198.00 scaled to all 8", () => {
  const r = buildReport(ledger, finished);
  if (r.kind !== "final") return assert.fail("expected a final report");
  assert.equal(r.netPerInvoiceDifference, 24.75);
  assert.equal(r.netDifferenceScaled, 198);
  assert.equal(r.verdict.verdict, "inconclusive", "4 invoices per route can't settle it");
  assert.ok(r.settleSample! > 4, "inconclusive reports the sample per route that would settle it");
});

test("hard first declines are listed as excluded, in neither route's eligible count", () => {
  const r = buildReport(ledger, finished);
  if (r.kind !== "final") return assert.fail();
  assert.deepEqual(r.excluded, [{ code: "2004", name: "Expired card", count: 2, amount: 128 }]);
  assert.equal(r.routes.A.eligible + r.routes.B.eligible, 8);
});

test("per-reason counts sum to the route totals; reasons sorted by uplift", () => {
  const r = buildReport(ledger, finished);
  if (r.kind !== "final") return assert.fail();
  for (const route of ["A", "B"] as const) {
    assert.equal(r.byReason.reduce((s, x) => s + x.routes[route].eligible, 0), r.routes[route].eligible);
    assert.equal(r.byReason.reduce((s, x) => s + x.routes[route].recovered, 0), r.routes[route].recovered);
  }
  const uplifts = r.byReason.map((x) => x.uplift ?? -Infinity);
  assert.deepEqual(uplifts, [...uplifts].sort((a, b) => b - a));
  assert.equal(r.byReason[0].label, "2001 · Insufficient funds");
});

test("a run on day 20 of 35 returns progress and no verdict", () => {
  const r = buildReport(ledger, { ...finished, status: "running", nextDay: 20 });
  assert.equal(r.kind, "progress");
  assert.ok(!("verdict" in r));
  if (r.kind === "progress") assert.equal(r.day, 20);
});

test("an early-stopped run is final, counts only closed invoices, and says it stopped early", () => {
  const late = invoice("b5", "B", 29, false, "2001", 20); // fails on day 20: window still open on day 22
  const r = buildReport([...ledger, ...late], { ...finished, status: "stopped", nextDay: 23, stop: { day: 22, rule: "Route B recovers significantly less", reason: "x" } });
  if (r.kind !== "final") return assert.fail();
  assert.equal(r.stoppedEarly?.rule, "Route B recovers significantly less");
  assert.equal(r.routes.B.eligible, 4, "the open invoice is not counted");
  assert.equal(r.routes.B.inWindow, 1);
});

test("results CSV: Diagnostic columns, one row per failed invoice, route A/B, data source", () => {
  const r = buildReport(ledger, { ...finished, gateway: "standin" });
  const csv = reportCsv(r, {});
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], CSV_COLUMNS.join(","));
  assert.equal(lines.length - 1, 10);
  const route = CSV_COLUMNS.indexOf("route");
  const source = CSV_COLUMNS.indexOf("data_source");
  assert.deepEqual([...new Set(lines.slice(1).map((l) => l.split(",")[route]))].sort(), ["A", "B"]);
  assert.ok(lines.slice(1).every((l) => l.split(",")[source] === "standin"));
});

test("CSV filters match the table: route and reason", () => {
  const r = buildReport(ledger, finished);
  const rows = reportCsv(r, { route: "B", reason: "2001" }).replace(/^﻿/, "").trim().split("\r\n").slice(1);
  assert.equal(rows.length, 2);
});

test("an early-stopped run doesn't count an invoice recovered while its window is still open", () => {
  // Fails on day 20, recovered on day 23; the run stopped after day 22, so its window (to day 34) is open.
  const lateWin = invoice("b6", "B", 29, true, "2001", 20);
  const stopped = { ...finished, status: "stopped", nextDay: 24, stop: { day: 23, rule: "Route B recovers significantly less", reason: "x" } };
  const r = buildReport([...ledger, ...lateWin], stopped);
  if (r.kind !== "final") return assert.fail();
  assert.equal(r.routes.B.eligible, 4);
  assert.equal(r.routes.B.recovered, 3);
  assert.equal(r.routes.B.inWindow, 1);
});

test("a discarded trial gets progress only, never a verdict", () => {
  const r = buildReport(ledger, { ...finished, status: "stopped", nextDay: 12, stop: { day: 11, rule: "Trial discarded", reason: "x", discarded: true } });
  assert.equal(r.kind, "progress");
});
