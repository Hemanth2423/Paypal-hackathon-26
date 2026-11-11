// Grounded AI summary (F2). Gemini via its OpenAI-compatible endpoint; every number in the text must appear in the
// facts we send, otherwise we retry once and then fall back to a template. Cached per sync so it costs one call.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Diagnostic } from "./diagnostic";

const CACHE_FILE = ".data/ai-summary.json";

export type Summary = { reasons: string[]; stake: string; source: "ai" | "template"; note?: string };
const VERSION = "v2"; // bump when the summary shape changes, so old cache entries are ignored

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);

export function leakFacts(d: Diagnostic) {
  return {
    failedRevenue: money(d.kpis.failedRevenue),
    recoverableRevenue: money(d.kpis.recoverableRevenue),
    hardDeclineRevenue: money(d.kpis.hardRevenue),
    currentRecoveryRate: pct(d.kpis.recoveryRate),
    hardDeclineRetries: d.waste.hardRetries,
    recoverableMrrPerMonth: money(d.stakes.recoverableMrrPerMonth),
    topLeaks: d.reasons.slice(0, 3).map((r) => ({
      reason: `${r.code} ${r.name}`,
      failedRevenue: money(r.amount),
      shareOfFailedRevenue: pct(r.share),
      recoveryRate: pct(r.recoveryRate),
      type: r.type === "soft" ? "retryable" : "not retryable",
    })),
  };
}

// Every number in `text` must appear in the facts (ignoring commas, $ and %). Small counting words like "3" are allowed.
export function numbersGrounded(text: string, facts: unknown): boolean {
  const norm = (s: string) => s.replace(/[$,%]/g, "");
  const allowed = new Set((JSON.stringify(facts).match(/\d[\d,]*(\.\d+)?/g) ?? []).map(norm));
  const found = (text.match(/\d[\d,]*(\.\d+)?/g) ?? []).map(norm);
  return found.every((n) => allowed.has(n) || Number(n) <= 3);
}

export function templateSummary(f: ReturnType<typeof leakFacts>): Pick<Summary, "reasons" | "stake"> {
  return {
    reasons: f.topLeaks.map(
      (l) => `${l.reason}: ${l.failedRevenue} (${l.shareOfFailedRevenue} of failed revenue), ${l.type}, recovered at ${l.recoveryRate}.`,
    ),
    stake:
      `You lost ${f.failedRevenue} to failed renewals; about ${f.recoverableMrrPerMonth} a month of retryable revenue goes unrecovered.` +
      (f.hardDeclineRetries > 0 ? ` Your process also retried hard declines ${f.hardDeclineRetries} times, and those retries can't succeed.` : ""),
  };
}

async function callModel(facts: unknown): Promise<Pick<Summary, "reasons" | "stake">> {
  const base = process.env.AI_BASE_URL!.replace(/\/?$/, "/");
  const res = await fetch(`${base}chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.AI_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You summarize a SaaS merchant's failed-payment leaks in plain English, second person, at most 150 words in total. " +
            "Use ONLY numbers that appear in the JSON facts, written exactly as given. Do not mention PayPal performance or make claims beyond the facts. " +
            'Reply with JSON only: {"reasons": [one short sentence per top leak, max 3], "stake": "one or two sentences on what is at stake"}.',
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = (json.choices?.[0]?.message?.content ?? "").replace(/^```(json)?|```$/gm, "").trim();
  const parsed = JSON.parse(raw) as { reasons?: unknown; stake?: unknown };
  return { reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 3) : [], stake: String(parsed.stake ?? "") };
}

export async function leakSummary(d: Diagnostic, cacheKey: string): Promise<Summary> {
  if (existsSync(CACHE_FILE)) {
    const cached = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (cached.key === `${VERSION}:${cacheKey}`) return cached.summary as Summary;
  }
  const facts = leakFacts(d);
  let summary: Summary = { ...templateSummary(facts), source: "template", note: "AI not configured" };
  if (process.env.AI_API_KEY && process.env.AI_BASE_URL && process.env.AI_MODEL) {
    summary = { ...summary, note: "AI output failed the number check" };
    try {
      for (let i = 0; i < 2; i++) {
        const out = await callModel(facts);
        const text = [...out.reasons, out.stake].join(" ");
        if (out.reasons.length && out.stake && text.split(/\s+/).length <= 150 && numbersGrounded(text, facts)) {
          summary = { ...out, source: "ai" };
          break;
        }
      }
    } catch (err) {
      summary = { ...summary, note: (err as Error).message };
    }
  }
  // Template results are not cached, so adding a key later takes effect without a resync.
  if (summary.source === "ai") writeFileSync(CACHE_FILE, JSON.stringify({ key: `${VERSION}:${cacheKey}`, summary }));
  return summary;
}
