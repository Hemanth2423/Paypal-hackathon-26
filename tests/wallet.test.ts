import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWalletConfig, missingReadiness, newWalletTrial, simulateWallet, walletReport, type WalletTrial } from "../src/lib/wallet/experiment";

const ids = Array.from({ length: 3000 }, (_, i) => `sm2-cust-${String(i + 1).padStart(4, "0")}`);
const START = "2026-11-12";
const trial = (patch: Partial<WalletTrial> = {}): WalletTrial => ({ ...newWalletTrial(), seed: "wallet-test", ...patch });

test("only customers who must act are eligible, split about 50/50", () => {
  const rows = simulateWallet(ids, trial(), START);
  assert.ok(rows.length > 300, String(rows.length));
  assert.ok(rows.every((r) => r.reason === "hard_decline" || r.reason === "retries_exhausted"));
  const share = rows.filter((r) => r.arm === "treatment").length / rows.length;
  assert.ok(Math.abs(share - 0.5) < 0.06, String(share));
});

test("control never pays with PayPal; the primary metric counts every assigned customer", () => {
  const t = trial();
  const rows = simulateWallet(ids, t, START);
  assert.equal(rows.filter((r) => r.arm === "control" && r.method === "paypal").length, 0);
  const r = walletReport(rows, t);
  assert.equal(r.groups.control.assigned + r.groups.treatment.assigned, rows.length);
  assert.equal(r.groups.treatment.recoveryRate, r.groups.treatment.recovered / r.groups.treatment.assigned);
});

test("results are reproducible for the same seed", () => {
  assert.deepEqual(simulateWallet(ids, trial(), START), simulateWallet(ids, trial(), START));
});

test("with zero lift and equal renewal odds, no consistent difference appears", () => {
  const t = trial({ assumptions: { ...newWalletTrial().assumptions, relativeLift: 0, paypalShare: 0 } });
  const r = walletReport(simulateWallet(ids, t, START), t);
  assert.ok(r.ci95 && r.ci95.low < 0 && r.ci95.high > 0, JSON.stringify(r.ci95));
});

test("a large assumed lift shows up as a large measured lift", () => {
  const t = trial({ assumptions: { ...newWalletTrial().assumptions, relativeLift: 1 } });
  const r = walletReport(simulateWallet(ids, t, START), t);
  assert.ok(r.uplift! > 0.15, String(r.uplift));
});

test("PayPal payments carry the higher PayPal fee", () => {
  const t = trial({ assumptions: { ...newWalletTrial().assumptions, paypalShare: 1 } });
  const paid = simulateWallet(ids, t, START).filter((r) => r.method === "paypal");
  assert.ok(paid.length > 0);
  for (const p of paid) assert.equal(p.fee, +(p.amount * 0.0349 + 0.49).toFixed(2));
});

test("config is clamped and readiness gates the run", () => {
  const t = applyWalletConfig(newWalletTrial(), { lengthDays: 999, assumptions: { baselineCompletion: 5 } as never });
  assert.equal(t.lengthDays, 60);
  assert.equal(t.assumptions.baselineCompletion, 0.95);
  assert.equal(missingReadiness(t).length, 4);
});
