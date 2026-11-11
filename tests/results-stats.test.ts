import { test } from "node:test";
import assert from "node:assert/strict";
import { newcombeInterval, twoProportionZTest } from "../src/lib/results/stats";

const near = (actual: number, expected: number, places = 4) =>
  assert.equal(actual.toFixed(places), expected.toFixed(places), `${actual} vs ${expected}`);

test("uplift interval matches Newcombe's published example (56/70 vs 48/80)", () => {
  // Newcombe (1998), method 10: difference 0.2000, 95% CI 0.0524 to 0.3339.
  const ci = newcombeInterval(48, 80, 56, 70)!;
  near(ci.low, 0.0524);
  near(ci.high, 0.3339);
});

test("interval is symmetric when the routes swap", () => {
  const ab = newcombeInterval(48, 80, 56, 70)!;
  const ba = newcombeInterval(56, 70, 48, 80)!;
  near(ba.low, -ab.high);
  near(ba.high, -ab.low);
});

test("p-value for 50/100 vs 65/100 is 0.032", () => {
  const t = twoProportionZTest(50, 100, 65, 100)!;
  assert.equal(t.pValue.toFixed(3), "0.032");
  assert.ok(t.z > 0, "Route B higher gives a positive z");
});

test("an empty route gives no interval and no p-value", () => {
  assert.equal(newcombeInterval(0, 0, 3, 10), null);
  assert.equal(twoProportionZTest(3, 10, 0, 0), null);
});

test("two routes that recovered everything give p = 1", () => {
  assert.equal(twoProportionZTest(10, 10, 12, 12)!.pValue, 1);
});
