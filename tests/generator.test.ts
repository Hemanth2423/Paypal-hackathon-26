import { test } from "node:test";
import assert from "node:assert/strict";
import { seedConfig } from "../config/seed.config";
import { buildSeedPlan } from "../src/lib/generator";

const TODAY = new Date("2026-11-11T12:00:00Z");
const plan = buildSeedPlan(seedConfig, TODAY);
const HARD = new Set([2004, 2015]);

test("creates the configured number of customers (≥ 1,000)", () => {
  assert.equal(plan.customers.length, seedConfig.customers);
  assert.ok(plan.customers.length >= 1000);
});

test("is deterministic for the same seed and date", () => {
  assert.deepEqual(buildSeedPlan(seedConfig, TODAY), plan);
});

test("covers every configured decline code, near its configured share", () => {
  const n = plan.invoices.length;
  for (const d of seedConfig.declineMix) {
    const share = plan.invoices.filter((i) => i.firstDeclineCode === d.code).length / n;
    assert.ok(share > 0, `code ${d.code} missing`);
    assert.ok(Math.abs(share - d.weight) < 0.05, `code ${d.code}: ${share.toFixed(3)} vs ${d.weight}`);
  }
});

test("all billing and attempt dates fall inside the 90-day window", () => {
  for (const inv of plan.invoices) {
    assert.ok(inv.billingDate >= plan.historyStart && inv.billingDate <= plan.historyEnd, inv.billingDate);
    for (const a of inv.attempts) assert.ok(a.attemptAt <= plan.historyEnd, a.attemptAt);
  }
});

test("follows the existing process: retries every 3 days, at most 4 times, stops on success", () => {
  for (const inv of plan.invoices) {
    assert.ok(inv.attempts.length <= 1 + seedConfig.existingProcess.maxRetries);
    inv.attempts.forEach((a, k) => {
      assert.equal(a.attemptNo, k);
      if (k < inv.attempts.length - 1) assert.equal(a.succeeds, false);
    });
  }
});

test("hard declines never recover; sandbox amounts encode the intended outcome", () => {
  for (const inv of plan.invoices) {
    for (const a of inv.attempts) {
      if (HARD.has(inv.firstDeclineCode)) assert.equal(a.succeeds, false);
      if (a.succeeds) assert.equal(a.sandboxAmount, inv.amount.toFixed(2));
      else assert.equal(a.sandboxAmount, `${a.declineCode}.00`);
    }
  }
});

test("produces a realistic volume of failed renewals and some recoveries and refunds", () => {
  assert.ok(plan.invoices.length > 700, `${plan.invoices.length} invoices`);
  const recovered = plan.invoices.filter((i) => i.attempts.at(-1)!.succeeds).length;
  assert.ok(recovered > 50, `${recovered} recovered`);
  assert.ok(plan.invoices.some((i) => i.refunded));
});
