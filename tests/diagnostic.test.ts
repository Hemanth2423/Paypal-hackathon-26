import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, buildInvoices, computeDiagnostic, CSV_COLUMNS, minDetectableUplift, requiredPerArm, toCsv } from "../src/lib/diagnostic";
import { numbersGrounded } from "../src/lib/ai";
import type { SyncedTransaction } from "../src/lib/sync";

let seq = 0;
const tx = (inv: string, no: number, code: string, status: string, at: string, extra: Partial<SyncedTransaction> = {}): SyncedTransaction => ({
  id: `t${++seq}`, orderId: `${inv}-a${no}`, status, amount: "29.00", currency: "USD",
  processorResponseCode: code, processorResponseText: "x", merchantAccountId: "ucb", customerId: "c1",
  cardBrand: "Visa", cardDebit: "No", cardLast4: "1111", refunded: false, createdAt: "",
  custom: { sm_invoice_id: inv, sm_subscription_id: "s1", sm_billing_date: "2026-09-01", sm_attempt_at: at, sm_attempt_no: String(no), sm_invoice_amount: "29.00" },
  ...extra,
});

const txns = [
  // recovered on retry 2, then refunded
  tx("i1", 0, "2001", "processor_declined", "2026-09-01"), tx("i1", 1, "2001", "processor_declined", "2026-09-04"),
  tx("i1", 2, "1000", "settled", "2026-09-07", { refunded: true }),
  // hard decline retried 4 times (2015 = do not retry → 4 over cap)
  ...[0, 1, 2, 3, 4].map((n) => tx("i2", n, "2015", "processor_declined", `2026-09-0${1 + n}`)),
  // soft, unrecovered, window still open relative to asOf
  { ...tx("i3", 0, "2000", "processor_declined", "2026-11-05"), custom: { ...tx("i3", 0, "2000", "x", "2026-11-05").custom, sm_billing_date: "2026-11-05" } },
];
const inv = buildInvoices(txns, "2026-11-10");
const byId = Object.fromEntries(inv.map((i) => [i.invoiceId, i]));

test("groups attempts into invoices with status, recovery and refunds", () => {
  assert.equal(inv.length, 3);
  assert.equal(byId.i1.status, "recovered");
  assert.equal(byId.i1.daysToRecover, 6);
  assert.equal(byId.i1.refundedAmount, 29);
  assert.equal(byId.i1.netRecovered, 0);
  assert.equal(byId.i3.status, "in_window");
});

test("classifies hard declines and counts retries over the network cap", () => {
  assert.equal(byId.i2.declineType, "hard");
  assert.equal(byId.i2.retriesOverCap, 4);
  assert.equal(byId.i2.excessFees, 0.4);
});

test("recovery rate ignores invoices still inside the window", () => {
  const d = computeDiagnostic(inv, {}, "2026-11-10");
  assert.equal(d.kpis.recoveryRate, 1); // i1 recovered; i3 undecided; i2 is hard (not in soft rate)
  assert.equal(d.waste.hardRetries, 4);
  assert.equal(d.kpis.hardRevenue, 29);
});

test("filters apply to rows", () => {
  assert.deepEqual(applyFilters(inv, { type: "hard" }).map((i) => i.invoiceId), ["i2"]);
  assert.equal(applyFilters(inv, { from: "2026-10-01" }).length, 1);
});

test("CSV has the spec's columns, BOM, and one row per invoice", () => {
  const csv = toCsv(inv, "2026-11-11T00:00:00Z");
  const lines = csv.trim().split("\r\n");
  assert.ok(csv.startsWith("﻿"));
  assert.equal(lines[0].replace("﻿", ""), CSV_COLUMNS.join(","));
  assert.equal(lines.length, 1 + inv.length);
  assert.equal(CSV_COLUMNS.length, 34);
  for (const l of lines.slice(1)) assert.equal(l.split(",").length, CSV_COLUMNS.length);
});

test("power math: classic 50%→60% needs ~385–390 per arm; MDE shrinks with more data", () => {
  const n = requiredPerArm(0.5, 0.1);
  assert.ok(n >= 380 && n <= 395, String(n));
  assert.ok(minDetectableUplift(0.3, 2000)! < minDetectableUplift(0.3, 200)!);
});

test("AI number check accepts grounded text and rejects invented numbers", () => {
  const facts = { failedRevenue: "$63,940", rate: "35.9%" };
  assert.ok(numbersGrounded("You lost $63,940; recovery is 35.9% across 3 reasons.", facts));
  assert.equal(numbersGrounded("You lost $70,000.", facts), false);
});
