import { test } from "node:test";
import assert from "node:assert/strict";
import { applyConfig, assignRoute, newTrial, preview, uncheckedReadiness } from "../src/lib/trial";
import type { Invoice } from "../src/lib/diagnostic";

const ids = Array.from({ length: 1000 }, (_, i) => `sm-cust-${String(i + 1).padStart(4, "0")}`);

test("assignment is sticky for the same seed and changes with a new seed", () => {
  const a = ids.map((c) => assignRoute(c, "seed-1", 50));
  assert.deepEqual(ids.map((c) => assignRoute(c, "seed-1", 50)), a);
  assert.notDeepEqual(ids.map((c) => assignRoute(c, "seed-2", 50)), a);
});

test("assignment follows the split within a few points", () => {
  for (const split of [30, 50, 70]) {
    const share = ids.filter((c) => assignRoute(c, "s", split) === "B").length / ids.length;
    assert.ok(Math.abs(share - split / 100) < 0.05, `${split}: ${share}`);
  }
});

test("config is clamped and can't change status", () => {
  const t = applyConfig(newTrial(), { lengthDays: 999, splitB: 3, status: "running" } as never);
  assert.equal(t.lengthDays, 60);
  assert.equal(t.splitB, 10);
  assert.equal(t.status, "draft");
});

test("start is blocked until every readiness item is checked", () => {
  const t = newTrial();
  assert.equal(uncheckedReadiness(t).length, 4);
  const ready = applyConfig(t, { readiness: { consent: true, dataScope: true, earlyStop: true, oneRoutePerInvoice: true } });
  assert.equal(uncheckedReadiness(ready).length, 0);
});

test("preview excludes hard declines and estimates power", () => {
  const inv = (id: string, cust: string, code: string, type: "soft" | "hard"): Invoice =>
    ({ invoiceId: id, customerId: cust, firstCode: code, declineName: code, declineType: type, amount: 29, planId: "starter", status: "unrecovered" }) as Invoice;
  const invoices = [inv("i1", ids[0], "2001", "soft"), inv("i2", ids[1], "2004", "hard"), inv("i3", ids[2], "2000", "soft")];
  const p = preview(newTrial(), ids, invoices, 60);
  assert.equal(p.groups.A.invoices + p.groups.B.invoices, 2);
  assert.deepEqual(p.excluded.map((e) => e.code), ["2004"]);
  assert.equal(p.power.expectedEligible, 180);
  assert.equal(p.power.resultsAfterDays, 35);
});
