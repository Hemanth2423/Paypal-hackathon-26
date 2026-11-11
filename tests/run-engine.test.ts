import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customerId } from "../src/lib/generator";
import { ruleFor } from "../src/lib/declines";
import { assignRoute, newTrial, type Trial } from "../src/lib/trial";
import { declineAmount } from "../src/lib/generator";
import { runEngine, type EngineEvent, type RunSettings } from "../src/lib/run/engine";
import { trialCustomers, type TrialCustomer } from "../src/lib/run/failures";
import type { SaleRequest, SaleResult, TrialGateway } from "../src/lib/run/gateway";
import { Ledger, countDuplicates, type LedgerRecord } from "../src/lib/run/ledger";
import { simulateTrial } from "../src/lib/run/simulate";
import { StandInGateway, standInToken } from "../src/lib/run/standin-gateway";
import { TrialRunner } from "../src/lib/run/runner";

const START = "2026-11-12";
const ids = Array.from({ length: 300 }, (_, i) => customerId(i + 1));
const customers: TrialCustomer[] = trialCustomers(ids).map((c) => ({ ...c, paymentMethodToken: standInToken(c.customerId), subscriptionId: `sub-${c.customerId}` }));
const settings = (over: Partial<RunSettings> = {}): RunSettings => ({
  runId: "r1",
  seed: "seed-1",
  splitB: 50,
  lengthDays: 21,
  windowDays: 14,
  startDate: START,
  earlyStop: { stopIfBWorse: false, maxComplaints: 5 },
  ...over,
});
const tmp = () => mkdtempSync(join(tmpdir(), "sm-engine-"));

async function run(gw: TrialGateway, ledger: Ledger, s = settings(), opts: { pauseBeforeDay?: number } = {}) {
  const events: EngineEvent[] = [];
  try {
    for await (const e of runEngine(s, { gateway: gw, customers, ledger, shouldPause: (day) => day === opts.pauseBeforeDay })) events.push(e);
  } catch (err) {
    events.push({ type: "error", message: (err as Error).message } as unknown as EngineEvent);
  }
  return events;
}
const shape = (records: LedgerRecord[]) =>
  records.map((r) => `${r.custom.sm_invoice_id}|${r.custom.sm_attempt_no}|${r.route}|${r.day}|${r.status}|${r.processorResponseCode}`).sort();

// Stand-in wrapped to misbehave in one chosen way.
class Wrapped implements TrialGateway {
  readonly kind = "standin" as const;
  calls = 0;
  constructor(readonly inner: StandInGateway, readonly hook: (req: SaleRequest, n: number, inner: StandInGateway) => Promise<SaleResult | null> | null) {}
  async sale(req: SaleRequest) {
    this.calls++;
    return (await this.hook(req, this.calls, this.inner)) ?? this.inner.sale(req);
  }
  findByOrderPrefix(p: string) {
    return this.inner.findByOrderPrefix(p);
  }
}

test("interrupted after a sale but before its ledger line: resume records it once and sends no second sale", async () => {
  const straight = new Ledger(join(tmp(), "l.jsonl"));
  await run(new StandInGateway({ duplicateCheck: false }), straight);

  const inner = new StandInGateway({ duplicateCheck: false }); // past the sandbox's 30-second window
  const crashing = new Wrapped(inner, async (req, n) => {
    if (n !== 150) return null;
    await inner.sale(req); // the sale goes through...
    throw new Error("process killed"); // ...and the process dies before the ledger line is written
  });
  const file = join(tmp(), "l.jsonl");
  const first = await run(crashing, new Ledger(file));
  assert.equal(first.at(-1)?.type, "error");
  const resumed = new Ledger(file);
  const events = await run(inner, resumed);
  assert.equal(events.at(-1)?.type, "complete");
  assert.deepEqual(shape(resumed.records), shape(straight.records));
  assert.equal(countDuplicates(await inner.findByOrderPrefix("sm-trial-r1-")), 0);
});

test("a full run completes; each invoice and customer sits on the route assignRoute gives", async () => {
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  const events = await run(new StandInGateway(), ledger);
  const done = events.at(-1)!;
  assert.equal(done.type, "complete");
  for (const r of ledger.records) assert.equal(r.route, assignRoute(r.customerId!, "seed-1", 50));
  if (done.type === "complete") {
    assert.equal(done.audit.ledgerDuplicates, 0);
    assert.equal(done.audit.gatewayDuplicates, 0);
    assert.equal(done.audit.complaints, 0);
    assert.equal(done.audit.maxComplaints, 5);
  }
});

test("no attempt is dated after its invoice's recovery window", async () => {
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  await run(new StandInGateway(), ledger);
  const firstDay = new Map<string, number>();
  for (const r of ledger.records) if (r.custom.sm_attempt_no === "0") firstDay.set(r.custom.sm_invoice_id, r.day);
  for (const r of ledger.records) assert.ok(r.day <= firstDay.get(r.custom.sm_invoice_id)! + 14, r.orderId);
});

test("a hard first decline has exactly one record and is reported as excluded", async () => {
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  const events = await run(new StandInGateway(), ledger);
  const hard = ledger.records.filter((r) => r.custom.sm_attempt_no === "0" && ruleFor(r.processorResponseCode).type === "hard");
  assert.ok(hard.length > 0);
  for (const h of hard) assert.equal(ledger.records.filter((r) => r.custom.sm_invoice_id === h.custom.sm_invoice_id).length, 1);
  const excluded = events.filter((e) => e.type === "day").reduce((s, e) => s + (e.type === "day" ? e.excluded.A + e.excluded.B : 0), 0);
  assert.equal(excluded, hard.length);
});

test("two runs of the same trial give the same records", async () => {
  const a = new Ledger(join(tmp(), "l.jsonl"));
  const b = new Ledger(join(tmp(), "l.jsonl"));
  await run(new StandInGateway(), a);
  await run(new StandInGateway(), b);
  assert.deepEqual(shape(a.records), shape(b.records));
});

test("pausing before day 10 and resuming gives the same ledger as a straight run", async () => {
  const straight = new Ledger(join(tmp(), "l.jsonl"));
  await run(new StandInGateway(), straight);
  const gw = new StandInGateway();
  const file = join(tmp(), "l.jsonl");
  const paused = await run(gw, new Ledger(file), settings(), { pauseBeforeDay: 10 });
  assert.deepEqual(paused.at(-1), { type: "paused", nextDay: 10 });
  const resumed = new Ledger(file);
  await run(gw, resumed);
  assert.deepEqual(shape(resumed.records), shape(straight.records));
});

test("a gateway rejection stops the day as an error, records no decline for it, and resume continues", async () => {
  const inner = new StandInGateway();
  let rejected = "";
  const gw = new Wrapped(inner, async (req, n) => {
    if (n !== 40) return null;
    rejected = req.orderId;
    return { outcome: "rejected", transaction: null, message: "Gateway Rejected: fraud" };
  });
  const file = join(tmp(), "l.jsonl");
  const ledger = new Ledger(file);
  const events = await run(gw, ledger);
  assert.equal(events.at(-1)?.type, "error");
  assert.match((events.at(-1) as unknown as { message: string }).message, /fraud/);
  assert.ok(!ledger.records.some((r) => r.orderId === rejected));
  const resumed = new Ledger(file);
  assert.equal((await run(inner, resumed)).at(-1)?.type, "complete");
  assert.ok(resumed.records.some((r) => r.orderId === rejected), "the rejected sale is sent again on resume");
});

test("a sale that is throttled twice is recorded once", async () => {
  const gw = new StandInGateway();
  gw.throttleNext(2);
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  await run(gw, ledger, settings({ lengthDays: 1, windowDays: 1 }));
  assert.equal(new Set(ledger.records.map((r) => r.orderId)).size, ledger.records.length);
  assert.ok(ledger.records.length > 0);
});

test("when the gateway returns a different code, the record and the next retry follow the gateway", async () => {
  // The sandbox remaps some test amounts by card brand: here every 2001 renewal comes back as 2000.
  const gw = new Wrapped(new StandInGateway(), (req, _n, inner) =>
    req.amount === declineAmount(2001) ? inner.sale({ ...req, amount: declineAmount(2000) }) : null,
  );
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  await run(gw, ledger);
  assert.ok(!ledger.records.some((r) => r.processorResponseCode === "2001"));
  // Route B treats them as "other soft" codes: first retry 2 days after the failure, not on a payday.
  const remapped = ledger.records.filter((r) => r.route === "B" && r.custom.sm_attempt_no === "1");
  const first = new Map(ledger.records.filter((r) => r.custom.sm_attempt_no === "0").map((r) => [r.custom.sm_invoice_id, r]));
  for (const r of remapped) {
    const f = first.get(r.custom.sm_invoice_id)!;
    if (f.processorResponseCode === "2000") assert.equal(r.day - f.day, 2, r.orderId);
  }
});

test("early stop: when Route B never recovers, the run stops once closed windows show it worse", async () => {
  // Every Route B retry that the model would approve is sent as a decline instead.
  const gw = new Wrapped(new StandInGateway(), (req, _n, inner) =>
    req.customFields.sm_route === "B" && Number(req.amount) < 2000 ? inner.sale({ ...req, amount: declineAmount(2046) }) : null,
  );
  const events = await run(gw, new Ledger(join(tmp(), "l.jsonl")), settings({ earlyStop: { stopIfBWorse: true, maxComplaints: 5 } }));
  const stop = events.at(-1)!;
  assert.equal(stop.type, "stopped");
  if (stop.type === "stopped") {
    assert.match(stop.rule, /Route B/);
    assert.ok(stop.day >= 14, "no invoice has a closed window before day 14");
  }
});

test("with the default model the early-stop rule does not fire", async () => {
  const events = await run(new StandInGateway(), new Ledger(join(tmp(), "l.jsonl")), settings({ earlyStop: { stopIfBWorse: true, maxComplaints: 5 } }));
  assert.equal(events.at(-1)?.type, "complete");
});

test("day events add up to the ledger", async () => {
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  const events = await run(new StandInGateway(), ledger);
  const days = events.filter((e) => e.type === "day");
  assert.equal(days.length, 35);
  const last = days.at(-1)!;
  if (last.type !== "day") return;
  const collected = ledger.records.filter((r) => r.status === "submitted_for_settlement");
  assert.equal(last.cumulative.collected.A + last.cumulative.collected.B, collected.length);
  assert.equal(last.cumulative.sales, ledger.records.length);
});

test("a full stand-in run lands on the same recoveries as the model-only simulation", async () => {
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  await run(new StandInGateway(), ledger);
  const sim = simulateTrial(customers, { seed: "seed-1", splitB: 50, lengthDays: 21, windowDays: 14, startDate: START });
  const simRecovered = sim.filter((i) => i.recoveredDay != null).map((i) => i.invoiceId).sort();
  const runRecovered = ledger.records.filter((r) => r.status === "submitted_for_settlement").map((r) => r.custom.sm_invoice_id).sort();
  assert.deepEqual(runRecovered, simRecovered);
});

// --- Runner: owns the run on the server ---

function workspace(trial: Trial) {
  const dir = tmp();
  mkdirSync(join(dir, ".data"));
  writeFileSync(join(dir, ".data/trial.json"), JSON.stringify(trial));
  writeFileSync(
    join(dir, ".data/sync-cache.json"),
    JSON.stringify({ summary: { historyEnd: "2026-11-11", syncedAt: "2026-11-11T00:00:00Z" }, customerIds: ids, transactions: [] }),
  );
  return dir;
}
const running = (): Trial => ({ ...newTrial(), seed: "seed-1", status: "running", startedAt: new Date().toISOString() });

test("runner: a second start during a run is refused and sends no extra sale", async () => {
  const gw = new StandInGateway({ latencyMs: 1 });
  const runner = new TrialRunner({ dir: workspace(running()), gateway: () => gw });
  assert.equal(runner.start().ok, true);
  const second = runner.start();
  assert.equal(second.ok, false);
  await runner.settled();
  assert.equal(runner.state().status, "complete");
  assert.equal(countDuplicates(await gw.findByOrderPrefix("sm-trial-")), 0);
});

test("runner: pause takes effect at a day boundary and resume continues to the end", async () => {
  const runner = new TrialRunner({ dir: workspace(running()), gateway: () => new StandInGateway({ latencyMs: 1 }) });
  runner.start();
  runner.pause();
  assert.equal(runner.state().status, "pausing");
  await runner.settled();
  assert.equal(runner.state().status, "paused");
  const at = runner.state().nextDay;
  assert.ok(at < 35);
  runner.start();
  await runner.settled();
  assert.equal(runner.state().status, "complete");
});

test("runner: deleting the trial mid-run stops the run at the next day boundary", async () => {
  const dir = workspace(running());
  const runner = new TrialRunner({ dir, gateway: () => new StandInGateway({ latencyMs: 2 }) });
  runner.start();
  await new Promise((r) => setTimeout(r, 30));
  rmSync(join(dir, ".data/trial.json"));
  await runner.settled();
  assert.equal(runner.state().status, "stopped");
  assert.match(runner.state().stop?.rule ?? "", /discarded/i);
});

test("runner: a trial that is still a draft can't start", () => {
  const runner = new TrialRunner({ dir: workspace(newTrial()), gateway: () => new StandInGateway() });
  const r = runner.start();
  assert.equal(r.ok, false);
});

test("TRIAL_CONCURRENCY caps the sandbox calls in flight; a missing or invalid value means 16", async () => {
  const { trialConcurrency } = await import("../src/lib/run/engine");
  let inFlight = 0;
  let peak = 0;
  const slow = new Wrapped(new StandInGateway(), async (req, _n, inner) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 2));
    const r = await inner.sale(req);
    inFlight--;
    return r;
  });
  process.env.TRIAL_CONCURRENCY = "4";
  try {
    await run(slow, new Ledger(join(tmp(), "l.jsonl")), settings());
    assert.equal(peak, 4);
    for (const bad of ["", "0", "abc", "100", "2.5"]) {
      process.env.TRIAL_CONCURRENCY = bad;
      assert.equal(trialConcurrency(), 16, `"${bad}"`);
    }
  } finally {
    delete process.env.TRIAL_CONCURRENCY;
  }
});

test("resume with an empty ledger still finds a sale made just before a crash, and records it once", async () => {
  const inner = new StandInGateway({ duplicateCheck: false });
  const crashFirst = new Wrapped(inner, async (req, n) => {
    if (n !== 1) return null;
    await inner.sale(req);
    throw new Error("process killed");
  });
  const file = join(tmp(), "l.jsonl");
  process.env.TRIAL_CONCURRENCY = "1"; // one sale in flight, so the crash lands before any ledger line
  try {
    await run(crashFirst, new Ledger(file));
  } finally {
    delete process.env.TRIAL_CONCURRENCY;
  }
  assert.equal(new Ledger(file).records.length, 0, "the crash left the ledger empty");
  const resumed = new Ledger(file);
  const events: EngineEvent[] = [];
  for await (const e of runEngine(settings(), { gateway: inner, customers, ledger: resumed, resume: true })) events.push(e);
  assert.equal(events.at(-1)?.type, "complete");
  const all = await inner.findByOrderPrefix("sm-trial-r1-");
  assert.equal(all.length, resumed.records.length, "every gateway sale is in the ledger, and none was sent twice");
});

test("a sale that times out after Braintree approved it is recorded once through the duplicate check", async () => {
  const inner = new StandInGateway(); // duplicate check on
  let timedOut = "";
  const gw = new Wrapped(inner, async (req, _n, g) => {
    if (timedOut || Number(req.amount) >= 2000) return null;
    timedOut = req.orderId;
    await g.sale(req); // approved at the gateway...
    throw Object.assign(new Error("Request timed out"), { type: "requestTimeoutError" }); // ...but the reply is lost
  });
  const ledger = new Ledger(join(tmp(), "l.jsonl"));
  const events = await run(gw, ledger);
  assert.equal(events.at(-1)?.type, "complete");
  assert.ok(timedOut, "an approval was intercepted");
  assert.equal(ledger.records.filter((r) => r.orderId === timedOut).length, 1);
  assert.equal(countDuplicates(await inner.findByOrderPrefix("sm-trial-r1-")), 0);
});

test("a duplicate rejection with no earlier sale stops the run with a clear error", async () => {
  const gw = new Wrapped(new StandInGateway(), async (_req, n) => (n === 3 ? { outcome: "rejected", transaction: null, message: "Gateway Rejected: duplicate" } : null));
  const events = await run(gw, new Ledger(join(tmp(), "l.jsonl")));
  assert.equal(events.at(-1)?.type, "error");
  assert.match((events.at(-1) as unknown as { message: string }).message, /duplicate/);
});

test("after pause and resume, every day's counts match a straight run", async () => {
  const dayEvents = async (pauseBeforeDay?: number) => {
    const gw = new StandInGateway();
    const file = join(tmp(), "l.jsonl");
    const byDay = new Map<number, unknown>();
    const keep = (es: EngineEvent[]) => es.forEach((e) => e.type === "day" && byDay.set(e.day, { n: e.newFailures, x: e.excluded, r: e.retries, c: e.collected }));
    keep(await run(gw, new Ledger(file), settings(), { pauseBeforeDay }));
    if (pauseBeforeDay != null) keep(await run(gw, new Ledger(file)));
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  };
  assert.deepEqual(await dayEvents(10), await dayEvents());
});
