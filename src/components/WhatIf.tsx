"use client";

import { useState } from "react";
import { ASSUMPTION_INFO, DEFAULT_ASSUMPTIONS, DEFAULT_POLICY, POLICY_LIMITS, type Assumptions, type RetryPolicy } from "@/lib/assumptions";
import type { WhatIfResult } from "@/lib/whatif";

const card = "rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-sm";
const input = "w-20 rounded-lg border border-line bg-card px-2 py-1.5 text-right";
const pct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const pp = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`);

export default function WhatIf() {
  const [a, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [p, setP] = useState<RetryPolicy>(DEFAULT_POLICY);
  const [lengthDays, setLength] = useState(21);
  const [splitB, setSplit] = useState(50);
  const [res, setRes] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/whatif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assumptions: a, policy: p, lengthDays, splitB }) });
      const j = await r.json();
      if (j.empty) setErr("Connect your merchant first.");
      else setRes(j);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-4xl font-light text-navy">What-if: try your own policy</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Change your retry policy and assumptions, then simulate the trial. Simulation only: it doesn&apos;t change your trial, its results, or any sandbox data.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <section className={card} aria-labelledby="wi-h">
          <h2 id="wi-h" className="text-lg font-semibold text-navy">Your settings</h2>
          <fieldset className="mt-4 grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Current retry policy (Route A)</legend>
            <label className="flex items-center justify-between text-sm">
              Retry every
              <span className="flex items-center gap-1">
                <input type="number" className={input} min={POLICY_LIMITS.retryEveryDays.min} max={POLICY_LIMITS.retryEveryDays.max} value={p.retryEveryDays} onChange={(e) => setP({ ...p, retryEveryDays: +e.target.value })} /> days
              </span>
            </label>
            <label className="flex items-center justify-between text-sm">
              Maximum retries
              <span className="flex items-center gap-1">
                <input type="number" className={input} min={POLICY_LIMITS.maxRetries.min} max={POLICY_LIMITS.maxRetries.max} value={p.maxRetries} onChange={(e) => setP({ ...p, maxRetries: +e.target.value })} /> tries
              </span>
            </label>
            <p className="text-xs text-muted">Route B (PayPal-style) gets the same maximum number of tries, timed by decline code. Retries only count inside the 14-day recovery window.</p>
          </fieldset>
          <fieldset className="mt-5 grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Assumptions</legend>
            {(Object.keys(ASSUMPTION_INFO) as (keyof Assumptions)[]).map((k) => (
              <label key={k} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {ASSUMPTION_INFO[k].label}{" "}
                  <span className="cursor-help text-action" title={`${ASSUMPTION_INFO[k].market}\nSource: ${ASSUMPTION_INFO[k].source}`} aria-label={ASSUMPTION_INFO[k].source} tabIndex={0}>ⓘ</span>
                </span>
                <span className="flex items-center gap-1">
                  <input type="number" className={input} value={+(a[k] * 100).toFixed(1)} onChange={(e) => setA({ ...a, [k]: Number(e.target.value) / 100 })} />
                  {k === "smartUplift" ? "pp" : "%"}
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="mt-5 grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Trial</legend>
            <label className="flex items-center justify-between text-sm">
              Length
              <select className="rounded-lg border border-line bg-card px-2 py-1.5" value={lengthDays} onChange={(e) => setLength(+e.target.value)}>
                {[14, 21, 30, 42].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <label className="text-sm">
              Split: Route A {100 - splitB}% · Route B {splitB}%
              <input type="range" min={10} max={90} step={5} value={splitB} onChange={(e) => setSplit(+e.target.value)} className="mt-2 w-full" />
            </label>
          </fieldset>
          <button className="mt-6 w-full rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-deep disabled:opacity-60" onClick={run} disabled={busy}>
            {busy ? "Simulating…" : "Run what-if"}
          </button>
          <button className="mt-2 w-full text-sm font-semibold text-action" onClick={() => (setA(DEFAULT_ASSUMPTIONS), setP(DEFAULT_POLICY), setLength(21), setSplit(50))}>
            Reset to defaults
          </button>
        </section>

        <section className={card} aria-live="polite" aria-labelledby="wr-h">
          <h2 id="wr-h" className="text-lg font-semibold text-navy">Simulated result</h2>
          {err && <p className="mt-3 text-sm text-bad">{err}</p>}
          {!res && !err && <p className="mt-3 text-sm text-muted">Set your policy and click Run what-if.</p>}
          {res && (
            <>
              <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-muted">Verdict (one simulated run)</p>
              <p className="text-3xl font-light text-navy">{res.run.verdict.label}</p>
              <p className="mt-2 text-sm">
                Route B changed recovery by <strong>{pp(res.run.uplift)}</strong> (95% interval {pp(res.run.ci95?.low)} to {pp(res.run.ci95?.high)}). {res.run.verdict.reason}
              </p>
              <table className="mt-4 w-full text-sm">
                <thead><tr className="text-left text-muted"><th className="font-normal" /><th>Route A · current</th><th>Route B · PayPal</th></tr></thead>
                <tbody>
                  <tr className="border-t border-line"><td className="py-1.5 text-muted">Eligible failures</td><td>{res.run.A.eligible.toLocaleString()}</td><td>{res.run.B.eligible.toLocaleString()}</td></tr>
                  <tr className="border-t border-line"><td className="py-1.5 text-muted">Recovered</td><td>{res.run.A.recovered.toLocaleString()}</td><td>{res.run.B.recovered.toLocaleString()}</td></tr>
                  <tr className="border-t border-line"><td className="py-1.5 text-muted">Recovery rate</td><td>{pct(res.run.A.rate)}</td><td>{pct(res.run.B.rate)}</td></tr>
                  <tr className="border-t border-line"><td className="py-1.5 text-muted">Recovered $ per eligible failure</td><td>${res.run.A.netPerEligible.toFixed(2)}</td><td>${res.run.B.netPerEligible.toFixed(2)}</td></tr>
                </tbody>
              </table>
              <div className="mt-4 rounded-xl bg-page p-4 text-sm">
                <p>
                  Across {res.average.runs} simulated runs: average uplift <strong>{pp(res.average.uplift)}</strong> (range {pp(res.average.min)} to {pp(res.average.max)}). One run can land anywhere in that range.
                </p>
                <p className="mt-1 text-muted">This trial size can detect an uplift of {pp(res.power.minDetectableUplift)} or more.</p>
              </div>
              <p className="mt-3 text-xs text-muted">Simulated from your settings. No sandbox calls; nothing saved.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
