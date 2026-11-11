import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customerId } from "../src/lib/generator";
import { newTrial, type Trial } from "../src/lib/trial";

// The route handlers read .data/ from the working directory, so each test file gets its own.
const dir = mkdtempSync(join(tmpdir(), "sm-api-"));
const trialFile = join(dir, ".data/trial.json");
const writeTrial = (t: Trial) => writeFileSync(trialFile, JSON.stringify(t));
before(() => {
  process.chdir(dir);
  process.env.TRIAL_GATEWAY = "standin";
  mkdirSync(".data");
  writeFileSync(
    ".data/sync-cache.json",
    JSON.stringify({ summary: { historyEnd: "2026-11-11", syncedAt: "2026-11-11T00:00:00Z" }, customerIds: Array.from({ length: 200 }, (_, i) => customerId(i + 1)), transactions: [] }),
  );
});

const api = async () => ({
  run: await import("../src/app/api/trial/run/route"),
  pause: await import("../src/app/api/trial/run/pause/route"),
  reset: await import("../src/app/api/trial/run/reset/route"),
  runner: (await import("../src/lib/run/runner")).getRunner(),
});

async function lines(res: Response) {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

test("GET before any run returns idle with the trial's settings", async () => {
  const { run } = await api();
  writeTrial({ ...newTrial(), status: "running" });
  const body = await (await run.GET()).json();
  assert.equal(body.state.status, "idle");
  assert.equal(body.trial.lengthDays, 21);
  assert.ok(body.assumptions.insufficientFunds.onPayday > 0);
});

test("POST while the trial is still a draft returns 409 and points to setup", async () => {
  const { run } = await api();
  writeTrial(newTrial());
  const res = await run.POST();
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /setup/i);
});

test("POST streams day events to the end; a second POST during the run starts nothing", async () => {
  const { run, runner } = await api();
  writeTrial({ ...newTrial(), seed: "api-seed", status: "running" });
  const res = await run.POST();
  assert.equal(res.status, 200);
  const second = await run.POST();
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /already in progress/);
  const events = await lines(res);
  assert.equal(events.filter((e) => e.type === "day").length, 35);
  assert.equal(events.at(-1).state.status, "complete");
  assert.equal(runner.state().audit?.gatewayDuplicates, 0);
});

test("pause takes effect at a day boundary; resume continues to the end", async () => {
  const { run, pause, reset, runner } = await api();
  await reset.POST();
  writeTrial({ ...newTrial(), seed: "api-seed-2", status: "running" });
  const res = await run.POST();
  await pause.POST();
  assert.equal(runner.state().status, "pausing");
  await lines(res);
  const paused = await (await run.GET()).json();
  assert.equal(paused.state.status, "paused");
  const resumed = await lines(await run.POST());
  assert.equal(resumed.at(-1).state.status, "complete");
});

test("deleting the trial mid-run stops the run at the next day boundary", async () => {
  const { run, reset, runner } = await api();
  await reset.POST();
  writeTrial({ ...newTrial(), seed: "api-seed-3", status: "running" });
  const res = await run.POST();
  rmSync(trialFile);
  await lines(res);
  assert.equal(runner.state().status, "stopped");
});
