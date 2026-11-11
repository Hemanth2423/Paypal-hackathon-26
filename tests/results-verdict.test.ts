import { test } from "node:test";
import assert from "node:assert/strict";
import { decideVerdict } from "../src/lib/results/verdict";

// Product.md F5: PayPal wins if the CI lower bound > 0 and net $ > 0; current wins if the upper bound < 0; else inconclusive.

test("lower bound above 0 with positive net: PayPal route wins", () => {
  const v = decideVerdict({ ciLow: 0.001, ciHigh: 0.3, netDifference: 0.01 });
  assert.equal(v.verdict, "paypal_wins");
  assert.equal(v.label, "PayPal route wins");
});

test("lower bound exactly 0: inconclusive", () => {
  assert.equal(decideVerdict({ ciLow: 0, ciHigh: 0.3, netDifference: 5 }).verdict, "inconclusive");
});

test("lower bound above 0 but net $ not above 0: inconclusive, with the net-revenue reason", () => {
  const v = decideVerdict({ ciLow: 0.02, ciHigh: 0.3, netDifference: 0 });
  assert.equal(v.verdict, "inconclusive");
  assert.match(v.reason, /net revenue/);
});

test("upper bound below 0: current route wins", () => {
  const v = decideVerdict({ ciLow: -0.3, ciHigh: -0.001, netDifference: -4 });
  assert.equal(v.verdict, "current_wins");
  assert.equal(v.label, "Current route wins");
});

test("upper bound exactly 0: inconclusive", () => {
  assert.equal(decideVerdict({ ciLow: -0.3, ciHigh: 0, netDifference: -4 }).verdict, "inconclusive");
});

test("missing interval or net difference: inconclusive, never a winner", () => {
  assert.equal(decideVerdict({ ciLow: null, ciHigh: null, netDifference: 3 }).verdict, "inconclusive");
  assert.equal(decideVerdict({ ciLow: 0.1, ciHigh: 0.2, netDifference: null }).verdict, "inconclusive");
});

test("the plan's worked example: [+2.1, +30.4] pp with +$3.10 per invoice", () => {
  assert.equal(decideVerdict({ ciLow: 0.021, ciHigh: 0.304, netDifference: 3.1 }).label, "PayPal route wins");
});
