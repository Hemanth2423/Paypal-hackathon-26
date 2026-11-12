import { test } from "node:test";
import assert from "node:assert/strict";
import { seedConfig } from "../config/seed.config";
import { dayOfMonth } from "../src/lib/run/calendar";
import { failuresForDay, trialCustomers, type NewFailure } from "../src/lib/run/failures";
import { successChance } from "../src/lib/run/outcomes";
import { DEFAULT_ASSUMPTIONS } from "../src/lib/assumptions";
import { nextRetryDay, type History } from "../src/lib/run/policies";
import { customerId } from "../src/lib/generator";

const START = "2026-11-01"; // day 0 = Nov 1 (30-day month)
const ctx = (windowDays = 14) => ({ startDate: START, windowDays });

// Plays a policy forward assuming every retry declines with the same code.
function plannedDays(route: "A" | "B", firstDay: number, code: string, windowDays = 14): number[] {
  const h: History = { firstDay, attempts: [{ day: firstDay, code, approved: false }] };
  const days: number[] = [];
  for (let d = nextRetryDay(route, h, ctx(windowDays)); d != null; d = nextRetryDay(route, h, ctx(windowDays))) {
    days.push(d);
    h.attempts.push({ day: d, code, approved: false });
    assert.ok(days.length < 50, "policy never stops");
  }
  return days;
}

test("Route A retries every 3 days, 4 times, inside the recovery window", () => {
  assert.deepEqual(plannedDays("A", 5, "2000"), [8, 11, 14, 17]);
});

test("Route A with a 7-day window retries on days 8 and 11 only", () => {
  assert.deepEqual(plannedDays("A", 5, "2000", 7), [8, 11]);
});

test("after a 2015 (hard) decline Route A still plans its next retry and Route B plans none", () => {
  assert.equal(plannedDays("A", 5, "2015")[0], 8);
  assert.deepEqual(plannedDays("B", 5, "2015"), []);
});

test("Route B, 2001 failing on the 3rd: retries on the 15th, then two days later", () => {
  assert.deepEqual(plannedDays("B", 2, "2001").map((d) => dayOfMonth(START, d)), [15, 17]);
});

test("Route B, 2001 failing on the 16th with no payday in the window: spaced retries", () => {
  assert.deepEqual(plannedDays("B", 15, "2001"), [18, 22, 26]);
});

test("Route B, 3000: the first retry is the next day", () => {
  assert.equal(plannedDays("B", 4, "3000")[0], 5);
});

test("Route B never plans more retries than Route A's maximum", () => {
  for (const code of ["2000", "2001", "2046", "3000"])
    for (let first = 0; first < 31; first++)
      assert.ok(plannedDays("B", first, code).length <= seedConfig.existingProcess.maxRetries, `${code} day ${first}`);
});

test("odds come from the assumptions: Route A recovers the current rate, Route B adds the uplift", () => {
  const a = DEFAULT_ASSUMPTIONS;
  const odds = (route: "A" | "B") => successChance({ firstCode: "2001", lastCode: "2001", failedRetries: 0, dayOfMonth: 8, route });
  const over4 = (p: number) => 1 - (1 - p) ** 4;
  assert.ok(Math.abs(over4(odds("A")) - a.currentRecovery) < 1e-9);
  assert.ok(Math.abs(over4(odds("B")) - (a.currentRecovery + a.smartUplift)) < 1e-9);
});

test("hard codes never clear", () => {
  assert.equal(successChance({ firstCode: "2004", lastCode: "2004", failedRetries: 0, dayOfMonth: 15, route: "B" }), 0);
  assert.equal(successChance({ firstCode: "2001", lastCode: "2004", failedRetries: 0, dayOfMonth: 15, route: "B" }), 0);
});

const customers = trialCustomers(Array.from({ length: 1000 }, (_, i) => customerId(i + 1)));

test("the same day always gives the same failures", () => {
  assert.deepEqual(failuresForDay(customers, START, 3), failuresForDay(customers, START, 3));
});

test("failure share and decline mix over 21 days match the seed config", () => {
  let renewals = 0;
  const failures: NewFailure[] = [];
  for (let day = 0; day < 21; day++) {
    renewals += customers.filter((c) => c.renewalDay === dayOfMonth(START, day)).length;
    failures.push(...failuresForDay(customers, START, day));
  }
  assert.ok(Math.abs(failures.length / renewals - seedConfig.renewalFailureRate) < 0.05, `${failures.length}/${renewals}`);
  for (const d of seedConfig.declineMix) {
    const share = failures.filter((f) => f.code === String(d.code)).length / failures.length;
    assert.ok(Math.abs(share - d.weight) < 0.05, `${d.code}: ${share.toFixed(3)} vs ${d.weight}`);
  }
});
