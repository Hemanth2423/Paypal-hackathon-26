// Verdict sweep (F4): plays 20 trials from the outcome model alone and prints each one's verdict.
// Usage: npm run sweep:f4 [-- <start date YYYY-MM-DD>]
// Passes when at least 16 of 20 seeds reach a verdict; re-run after any change to trialModel in config/seed.config.ts.

import { seedConfig } from "../config/seed.config";
import { customerId } from "../src/lib/generator";
import { trialCustomers } from "../src/lib/run/failures";
import { simulateTrial, type SimInvoice } from "../src/lib/run/simulate";
import { newcombeInterval, twoProportionZTest } from "../src/lib/results/stats";
import { decideVerdict } from "../src/lib/results/verdict";

const startDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const customers = trialCustomers(Array.from({ length: seedConfig.customers }, (_, i) => customerId(i + 1)));
const pct = (x: number | null) => (x == null ? "  n/a" : `${(x * 100).toFixed(1).padStart(5)}%`);
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;

function route(invs: SimInvoice[], r: "A" | "B") {
  const e = invs.filter((i) => i.soft && i.route === r);
  const won = e.filter((i) => i.recoveredDay != null);
  return { n: e.length, x: won.length, rate: e.length ? won.length / e.length : null, netPer: e.length ? won.reduce((s, i) => s + i.amount, 0) / e.length : null };
}

const tally: Record<string, number> = {};
const codeRates: Record<string, { A: number[]; B: number[] }> = {};
for (let i = 1; i <= 20; i++) {
  const invs = simulateTrial(customers, { seed: `sweep-${i}`, splitB: 50, lengthDays: 21, windowDays: 14, startDate });
  const A = route(invs, "A");
  const B = route(invs, "B");
  const ci = newcombeInterval(A.x, A.n, B.x, B.n);
  const p = twoProportionZTest(A.x, A.n, B.x, B.n)?.pValue;
  const v = decideVerdict({ ciLow: ci?.low ?? null, ciHigh: ci?.high ?? null, netDifference: A.netPer != null && B.netPer != null ? B.netPer - A.netPer : null });
  tally[v.verdict] = (tally[v.verdict] ?? 0) + 1;
  for (const inv of invs.filter((x) => x.soft)) {
    codeRates[inv.code] ??= { A: [], B: [] };
    codeRates[inv.code][inv.route].push(inv.recoveredDay != null ? 1 : 0);
  }
  console.log(
    `sweep-${String(i).padStart(2)}  n A/B ${A.n}/${B.n}  rate A/B ${pct(A.rate)} /${pct(B.rate)}  ` +
      `uplift ${pp((B.rate ?? 0) - (A.rate ?? 0))} pp  CI [${pp(ci?.low ?? 0)}, ${pp(ci?.high ?? 0)}]  p ${p?.toFixed(3)}  ${v.label}`,
  );
}

console.log(`\nStart date ${startDate}. Verdicts:`, tally);
console.log("\nRecovery by first decline code (all seeds). History = the seeded process's implied rate (4 retries at the seed odds).");
for (const [code, r] of Object.entries(codeRates).sort()) {
  const odds = seedConfig.declineMix.find((d) => String(d.code) === code)?.retrySuccess ?? 0;
  const history = 1 - (1 - odds) ** seedConfig.existingProcess.maxRetries;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  console.log(`  ${code}  Route A ${pct(mean(r.A))}  Route B ${pct(mean(r.B))}  history ${pct(history)}`);
}
const verdicts = 20 - (tally.inconclusive ?? 0);
console.log(`\n${verdicts} of 20 seeds reached a verdict: ${verdicts >= 16 ? "PASS" : "FAIL (stop condition)"}`);
process.exitCode = verdicts >= 16 ? 0 : 1;
