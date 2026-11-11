import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { customerId } from "../src/lib/generator";
import { newTrial } from "../src/lib/trial";
import type { ChatMessage, Complete, ToolCall, ToolSpec } from "../src/lib/analyst/client";

// Each test file runs in its own process; this one gets its own working directory and a finished stand-in trial.
before(async () => {
  process.chdir(mkdtempSync(join(tmpdir(), "sm-analyst-")));
  process.env.TRIAL_GATEWAY = "standin";
  mkdirSync(".data");
  writeFileSync(
    ".data/sync-cache.json",
    JSON.stringify({ summary: { historyEnd: "2026-11-10", syncedAt: "2026-11-11T00:00:00Z" }, customerIds: Array.from({ length: 1000 }, (_, i) => customerId(i + 1)), transactions: [] }),
  );
});
const mods = async () => ({
  analyst: await import("../src/lib/analyst/analyst"),
  client: await import("../src/lib/analyst/client"),
  runner: (await import("../src/lib/run/runner")).getRunner(),
  load: await import("../src/lib/results/load"),
});
async function finishTrial() {
  const { runner } = await mods();
  writeFileSync(".data/trial.json", JSON.stringify({ ...newTrial(), id: "trial-an01", seed: "sweep-4", status: "running" }));
  if (runner.state().status !== "complete") {
    runner.start();
    await runner.settled();
  }
}

const call = (name: string, args: unknown, id = "c1"): ToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
// A scripted model: cycles through the given replies and records what it was sent.
function scripted(...replies: { content?: string; tool_calls?: ToolCall[] }[]) {
  const sent: { messages: ChatMessage[]; tools: ToolSpec[] }[] = [];
  const fn: Complete = async (messages, tools) => {
    sent.push({ messages: structuredClone(messages), tools });
    const r = replies[(sent.length - 1) % replies.length];
    return { content: r.content ?? null, tool_calls: r.tool_calls };
  };
  return Object.assign(fn, { sent });
}
const toolResult = (m: ChatMessage[]) => JSON.parse((m.find((x) => x.role === "tool") as { content: string }).content);

test("before any run, a trial question gets the tool's no-trial answer", async () => {
  const { analyst } = await mods();
  const model = scripted({ tool_calls: [call("get_metrics", { scope: "trial" })] }, { content: "No trial has run yet." });
  const a = await analyst.ask("How did the trial go? (pre-run)", model);
  assert.match(toolResult(model.sent[1].messages).error, /No trial has run/);
  assert.equal(a.status, "answered");
});

test("a question is answered through a tool call, with the cited metric and a server-built link", async () => {
  await finishTrial();
  const { analyst } = await mods();
  const probe = scripted({ tool_calls: [call("compare_routes", { metric: "recovery_rate", reason: "2001" })] }, { content: "x" });
  await analyst.ask("probe 2001", probe);
  const figures = toolResult(probe.sent[1].messages).figures as Record<string, string>;
  const rateB = figures["Route B Recovery rate"];
  const model = scripted({ tool_calls: [call("compare_routes", { metric: "recovery_rate", reason: "2001" })] }, { content: `For insufficient funds, the Route B recovery rate was ${rateB}.` });
  const a = await analyst.ask("Which decline reason drove the uplift?", model);
  assert.equal(a.status, "answered");
  assert.deepEqual(a.citations[0], { metric: "Route B Recovery rate", value: rateB });
  assert.deepEqual(a.links, ["/results?reason=2001"]);
});

test("a number missing from every tool result gets one retry, then the can't-answer reply", async () => {
  const { analyst } = await mods();
  const model = scripted({ tool_calls: [call("get_metrics", { scope: "trial" })] }, { content: "Smart Retries recovers 38.4% more for real merchants." });
  const a = await analyst.ask("What recovery rate does Smart Retries get for real merchants?", model);
  assert.equal(a.status, "cant_answer");
  assert.equal(a.text, analyst.CANT_ANSWER);
  assert.equal(model.sent.length, 4, "two attempts of tool call + answer");
});

test("a percentage stated without calling any tool is rejected the same way", async () => {
  const { analyst } = await mods();
  const model = scripted({ content: "Your recovery rate is 72.5%." });
  assert.equal((await analyst.ask("What's my recovery rate? (no tool)", model)).status, "cant_answer");
});

test("an unknown tool or malformed arguments return a tool error to the model, not a crash", async () => {
  const { analyst } = await mods();
  const bad: ToolCall = { id: "c2", type: "function", function: { name: "get_metrics", arguments: "{not json" } };
  const model = scripted({ tool_calls: [call("drop_tables", {}), bad] }, { content: analyst.CANT_ANSWER });
  const a = await analyst.ask("break things", model);
  const tools = model.sent[1].messages.filter((m) => m.role === "tool").map((m) => JSON.parse((m as { content: string }).content));
  assert.match(tools[0].error, /Unknown tool/);
  assert.match(tools[1].error, /not valid JSON/);
  assert.equal(a.status, "cant_answer");
});

test("the same question on the same run is served from cache with no model call", async () => {
  const { analyst } = await mods();
  const model = scripted({ tool_calls: [call("get_metrics", { scope: "trial" })] }, { content: "The trial has a verdict." });
  await analyst.ask("Summarise the trial", model);
  const calls = model.sent.length;
  const again = await analyst.ask("summarise   the trial", model);
  assert.equal(model.sent.length, calls);
  assert.equal(again.cached, true);
});

test("two questions at once run one after the other", async () => {
  const { analyst } = await mods();
  let inFlight = 0;
  let maxInFlight = 0;
  const slow: Complete = async () => {
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--;
    return { content: "Nothing to add." };
  };
  await Promise.all([analyst.ask("first concurrent", slow), analyst.ask("second concurrent", slow)]);
  assert.equal(maxInFlight, 1);
});

test("a rate limit and a missing key each give their own designed result", async () => {
  const { analyst, client } = await mods();
  const limited: Complete = async () => {
    throw new client.AiLimitError("429");
  };
  assert.equal((await analyst.ask("limit?", limited)).status, "limited");
  delete process.env.AI_API_KEY;
  assert.equal((await analyst.ask("off?")).status, "off");
});

test("the request sends no temperature, tool_choice auto, and no response_format", async () => {
  const { client } = await mods();
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  }) as typeof fetch;
  Object.assign(process.env, { AI_API_KEY: "test-key", AI_BASE_URL: "https://example.invalid/v1", AI_MODEL: "m" });
  try {
    await client.complete([{ role: "user", content: "hi" }], (await import("../src/lib/analyst/tools")).TOOL_SPECS);
  } finally {
    globalThis.fetch = original;
    delete process.env.AI_API_KEY;
  }
  assert.equal(body.tool_choice, "auto");
  assert.ok(!("temperature" in body));
  assert.ok(!("response_format" in body));
});

test("report summary: a contradicting verdict is rejected; a grounded one is used and cached", async () => {
  const { analyst, load } = await mods();
  const loaded = load.loadReport();
  assert.ok(loaded.report && loaded.report.kind === "final");
  if (!loaded.report || loaded.report.kind !== "final") return;
  const r = loaded.report;
  const wrong = r.verdict.verdict === "current_wins" ? "PayPal route wins" : "Current route wins";
  const bad = await analyst.reportSummary(r, "run-x", scripted({ content: `${wrong}, despite everything.` }));
  assert.equal(bad.source, "template");
  const rateB = `${((r.routes.B.recoveryRate ?? 0) * 100).toFixed(1)}%`;
  const good = await analyst.reportSummary(r, "run-y", scripted({ content: `Route B recovered ${rateB} of its failed invoices.` }));
  assert.equal(good.source, "ai");
  assert.equal(good.verdict.startsWith(r.verdict.label), true, "the verdict sentence comes from the rules");
  const again = await analyst.reportSummary(r, "run-y", scripted({ content: "different text" }));
  assert.deepEqual(again, good);
});
