// What-if (simulation only): plays the trial from the model with the merchant's own settings. No sandbox calls,
// and nothing saved, so the real trial, its results and the sandbox data are untouched.

import { activeAssumptions, clampAssumptions, clampPolicy, getActivePolicy, setActiveAssumptions, setActivePolicy, type Assumptions, type RetryPolicy } from "./assumptions";
import { minDetectableUplift } from "./diagnostic";
import { newcombeInterval, twoProportionZTest } from "./results/stats";
import { decideVerdict } from "./results/verdict";
import { trialCustomers } from "./run/failures";
import { simulateTrial } from "./run/simulate";

export type WhatIfInput = { assumptions?: Partial<Assumptions>; policy?: Partial<RetryPolicy>; lengthDays?: number; splitB?: number };

const RUNS = 5; // independent simulated runs, to show how much one run can vary

export function runWhatIf(customerIds: string[], input: WhatIfInput) {
  const prevA = activeAssumptions();
  const prevP = getActivePolicy();
  const assumptions = clampAssumptions(input.assumptions);
  const policy = clampPolicy(input.policy);
  const lengthDays = Math.min(60, Math.max(7, Math.round(Number(input.lengthDays) || 21)));
  const splitB = Math.min(90, Math.max(10, Math.round(Number(input.splitB) || 50)));
  try {
    setActiveAssumptions(assumptions);
    setActivePolicy(policy);
    const customers = trialCustomers(customerIds);
    const startDate = new Date().toISOString().slice(0, 10);
    const runs = Array.from({ length: RUNS }, (_, i) => {
      const inv = simulateTrial(customers, { seed: `what-if-${i + 1}`, splitB, lengthDays, windowDays: 14, startDate }).filter((x) => x.soft);
      const g = (route: "A" | "B") => {
        const list = inv.filter((x) => x.route === route);
        const rec = list.filter((x) => x.recoveredDay != null);
        return { eligible: list.length, recovered: rec.length, rate: list.length ? rec.length / list.length : 0, netPerEligible: list.length ? rec.reduce((s, x) => s + x.amount, 0) / list.length : 0 };
      };
      return { A: g("A"), B: g("B") };
    });
    const first = runs[0];
    const ci = newcombeInterval(first.A.recovered, first.A.eligible, first.B.recovered, first.B.eligible);
    const verdict = decideVerdict({ ciLow: ci?.low ?? null, ciHigh: ci?.high ?? null, netDifference: first.B.netPerEligible - first.A.netPerEligible });
    const uplifts = runs.map((r) => r.B.rate - r.A.rate);
    return {
      settings: { assumptions, policy, lengthDays, splitB },
      run: { ...first, uplift: first.B.rate - first.A.rate, ci95: ci, pValue: twoProportionZTest(first.A.recovered, first.A.eligible, first.B.recovered, first.B.eligible)?.pValue ?? null, verdict },
      average: { runs: RUNS, uplift: uplifts.reduce((s, x) => s + x, 0) / RUNS, min: Math.min(...uplifts), max: Math.max(...uplifts), verdicts: runs.length },
      power: { minDetectableUplift: minDetectableUplift(first.A.rate, Math.min(first.A.eligible, first.B.eligible)) },
    };
  } finally {
    setActiveAssumptions(prevA);
    setActivePolicy(prevP);
  }
}

export type WhatIfResult = ReturnType<typeof runWhatIf>;
