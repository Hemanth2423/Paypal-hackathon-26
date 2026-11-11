import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customerId } from "../src/lib/generator";
import { newTrial } from "../src/lib/trial";

before(() => {
  process.chdir(mkdtempSync(join(tmpdir(), "sm-results-")));
  process.env.TRIAL_GATEWAY = "standin";
  mkdirSync(".data");
  writeFileSync(
    ".data/sync-cache.json",
    JSON.stringify({ summary: { historyEnd: "2026-11-11", syncedAt: "2026-11-11T00:00:00Z" }, customerIds: Array.from({ length: 400 }, (_, i) => customerId(i + 1)), transactions: [] }),
  );
  writeFileSync(".data/trial.json", JSON.stringify({ ...newTrial(), seed: "results-seed", status: "running" }));
});

const mods = async () => ({
  results: await import("../src/app/api/results/route"),
  csv: await import("../src/app/api/results/export/route"),
  runner: (await import("../src/lib/run/runner")).getRunner(),
});
const csvRows = async (res: Response) => (await res.text()).replace(/^﻿/, "").trim().split("\r\n").slice(1);

test("before any run: the empty payload, and the export says no trial has run", async () => {
  const { results, csv } = await mods();
  assert.deepEqual(await (await results.GET()).json(), { empty: true });
  assert.equal((await csv.GET(new Request("http://x/api/results/export"))).status, 404);
});

test("while the run is paused: progress only, with no verdict", async () => {
  const { results, runner } = await mods();
  runner.start();
  runner.pause();
  await runner.settled();
  const body = await (await results.GET()).json();
  assert.equal(body.kind, "progress");
  assert.equal(body.verdict, undefined);
});

test("once complete: the full report, and the export's rows match the filtered invoices", async () => {
  const { results, csv, runner } = await mods();
  runner.start();
  await runner.settled();
  const body = await (await results.GET()).json();
  assert.equal(body.kind, "final");
  assert.ok(body.verdict.label);
  const all = await csvRows(await csv.GET(new Request("http://x/api/results/export")));
  assert.equal(all.length, body.invoices.length);
  const filtered = await csvRows(await csv.GET(new Request("http://x/api/results/export?route=B&reason=2001")));
  const expected = body.invoices.filter((i: { route: string; firstCode: string }) => i.route === "B" && i.firstCode === "2001").length;
  assert.equal(filtered.length, expected);
  assert.ok(expected > 0);
});
