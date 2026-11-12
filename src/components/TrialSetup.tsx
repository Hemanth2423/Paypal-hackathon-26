"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Trial, TrialPreview } from "@/lib/trial";
import { ASSUMPTION_INFO, DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/assumptions";
import TrialRun from "./TrialRun";

const READINESS: { key: keyof Trial["readiness"]; label: string }[] = [
  { key: "consent", label: "Merchant consent and trial terms accepted" },
  { key: "dataScope", label: "Data-access scope confirmed (read payments, run retries on Route B)" },
  { key: "earlyStop", label: "Early-stop rules reviewed" },
  { key: "oneRoutePerInvoice", label: "Each invoice is retried by exactly one route" },
];
const STEPS = ["Configure", "Review groups", "Readiness"];

const card = "rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-sm";
const primary = "w-full rounded-full bg-navy px-6 py-3.5 font-semibold text-white hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "w-full rounded-full border-2 border-action px-6 py-3 font-semibold text-action hover:bg-action/5";
const field = "mt-1 w-full rounded-lg border border-line bg-card px-3 py-2.5";
const pct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

type State = { kind: "loading" } | { kind: "empty" } | { kind: "error"; msg: string } | { kind: "ok"; trial: Trial; preview: TrialPreview };

export default function TrialSetup() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [step, setStep] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const apply = (json: { empty?: boolean; trial?: Trial; preview?: TrialPreview; error?: string }) => {
    if (json.empty) setState({ kind: "empty" });
    else if (json.error) setState({ kind: "error", msg: json.error });
    else setState({ kind: "ok", trial: json.trial!, preview: json.preview! });
  };

  const load = useCallback(async () => {
    try {
      apply(await (await fetch("/api/trial")).json());
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Optimistic local update, then save (debounced for sliders).
  function update(patch: Partial<Trial>, delay = 250) {
    if (state.kind !== "ok") return;
    const trial = { ...state.trial, ...patch, earlyStop: { ...state.trial.earlyStop, ...patch.earlyStop }, readiness: { ...state.trial.readiness, ...patch.readiness } };
    setState({ ...state, trial });
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/trial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trial) });
        apply(await res.json());
      } catch (e) {
        setState({ kind: "error", msg: (e as Error).message });
      }
    }, delay);
  }

  async function start() {
    setStartError(null);
    const res = await fetch("/api/trial/start", { method: "POST" });
    const json = await res.json();
    if (!res.ok) return setStartError(json.missing ? `Still needed: ${json.missing.join("; ")}` : json.error);
    load();
  }

  async function discard() {
    if (!confirm("Discard this trial? Its settings and group assignment seed will be lost.")) return;
    await fetch("/api/trial", { method: "DELETE" });
    setStep(0);
    load();
  }

  if (state.kind === "loading")
    return (
      <div className="mx-auto grid max-w-[480px] animate-pulse gap-4" aria-busy="true" aria-label="Loading trial">
        <div className="h-10 rounded bg-line" />
        <div className="h-80 rounded-[16px] bg-line" />
      </div>
    );
  if (state.kind === "empty")
    return (
      <div className={`${card} mx-auto max-w-[480px] text-center`}>
        <h1 className="text-2xl font-light text-navy">Connect your merchant first</h1>
        <p className="mt-2 text-sm text-muted">The trial assigns your customers to two routes, so we need your Braintree data.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-navy px-6 py-3 font-semibold text-white">Go to Connect</Link>
      </div>
    );
  if (state.kind === "error")
    return (
      <div className={`${card} mx-auto max-w-[480px]`} role="alert">
        <p className="text-sm font-semibold text-bad">Couldn&apos;t load the trial</p>
        <p className="mt-2 text-sm text-muted">{state.msg}</p>
        <button onClick={load} className={`${primary} mt-6`}>Try again</button>
      </div>
    );

  const { trial: t, preview: p } = state;
  const missing = READINESS.filter((r) => !t.readiness[r.key]).map((r) => r.label);

  if (t.status === "running") return <TrialRun trial={t} preview={p} onDiscard={discard} />;

  return (
    <section className="mx-auto max-w-[480px]">
      <h1 className="text-center text-4xl font-light text-navy">Set up your trial</h1>
      <p className="mt-3 text-center text-muted">Split your customers into two routes and compare which recovers more.</p>

      <ol className="mt-8 flex items-center justify-between text-sm" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
            <span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${i < step ? "bg-ok text-white" : i === step ? "bg-navy text-white" : "bg-line text-muted"}`}>
              {i < step ? "✓" : i + 1}
            </span>
            <span className={i === step ? "font-semibold text-navy" : "text-muted"}>{s}</span>
          </li>
        ))}
      </ol>

      <div className={`${card} mt-6`}>
        {step === 0 && (
          <div className="grid gap-5">
            <label className="text-sm font-semibold">
              Trial length
              <select className={field} value={t.lengthDays} onChange={(e) => update({ lengthDays: +e.target.value }, 0)}>
                {[14, 21, 28, 42].map((d) => <option key={d} value={d}>{d} days{d === 21 ? " (recommended)" : ""}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-muted">Renewals that fail during this period join the trial.</span>
            </label>
            <label className="text-sm font-semibold">
              Recovery window
              <select className={field} value={t.recoveryWindowDays} onChange={(e) => update({ recoveryWindowDays: +e.target.value }, 0)}>
                {[7, 14, 21, 30].map((d) => <option key={d} value={d}>{d} days{d === 14 ? " (recommended)" : ""}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-muted">How long each failed renewal is followed before it counts as lost.</span>
            </label>
            <label className="text-sm font-semibold">
              Split: Route A {100 - t.splitB}% · Route B {t.splitB}%
              <input type="range" min={10} max={90} step={5} value={t.splitB} onChange={(e) => update({ splitB: +e.target.value })} className="mt-2 w-full accent-[var(--color-action)]" aria-valuetext={`Route B ${t.splitB} percent`} />
              <span className="flex justify-between text-xs font-normal text-muted"><span>More on current process</span><span>More on PayPal</span></span>
            </label>
            <fieldset className="grid gap-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Simulation assumptions</legend>
              <p className="text-xs text-muted">Defaults come from published market benchmarks (hover ⓘ for the source), not from tuning for a win. Change them to match your business.</p>
              {(Object.keys(ASSUMPTION_INFO) as (keyof Assumptions)[]).map((k) => {
                const info = ASSUMPTION_INFO[k];
                const value = t.assumptions?.[k] ?? DEFAULT_ASSUMPTIONS[k];
                return (
                  <label key={k} className="grid grid-cols-[1fr_96px] items-center gap-3 text-sm">
                    <span>
                      {info.label}{" "}
                      <span className="cursor-help text-action" title={`${info.market}\nSource: ${info.source}`} aria-label={`${info.market} Source: ${info.source}`} tabIndex={0}>ⓘ</span>
                      <span className="block text-xs text-muted">Default {k === "smartUplift" ? "+" : ""}{(DEFAULT_ASSUMPTIONS[k] * 100).toFixed(0)}{k === "smartUplift" ? " pp" : "%"}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        step={1}
                        min={info.min * 100}
                        max={info.max * 100}
                        value={+(value * 100).toFixed(1)}
                        onChange={(e) => update({ assumptions: { ...(t.assumptions ?? DEFAULT_ASSUMPTIONS), [k]: Number(e.target.value) / 100 } })}
                        className="w-20 rounded-lg border border-line bg-card px-2 py-1.5 text-right"
                      />
                      <span className="text-muted">{k === "smartUplift" ? "pp" : "%"}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="rounded-xl bg-page p-4 text-sm" aria-live="polite">
              <p className="font-semibold text-navy">What this trial can tell you</p>
              <p className="mt-1">
                About {p.power.expectedEligible} retryable failures ({p.power.perGroup.A} on A, {p.power.perGroup.B} on B).{" "}
                {p.power.minDetectableUplift == null
                  ? "Too few to detect any uplift. Try a longer trial."
                  : `It can detect an uplift of ${(p.power.minDetectableUplift * 100).toFixed(1)} pp or more at 80% power.`}
              </p>
              <p className="mt-1 text-xs text-muted">Baseline recovery {pct(p.power.baselineRate)}. Results ready {p.power.resultsAfterDays} days after start. Longer trials and a 50/50 split detect smaller differences.</p>
            </div>
            <button className={primary} onClick={() => setStep(1)}>Continue</button>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-5">
            <div>
              <h2 className="font-semibold text-navy">Are the two groups alike?</h2>
              <p className="text-sm text-muted">Compared on each group&apos;s last 90 days of retryable failures.</p>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted"><th className="font-normal" /><th className="font-semibold">Route A</th><th className="font-semibold">Route B</th></tr></thead>
              <tbody>
                {[
                  ["Customers", p.groups.A.customers.toLocaleString(), p.groups.B.customers.toLocaleString()],
                  ["Failed renewals", p.groups.A.invoices.toLocaleString(), p.groups.B.invoices.toLocaleString()],
                  ["Failed revenue", money(p.groups.A.amount), money(p.groups.B.amount)],
                  ["Recovery rate today", pct(p.groups.A.recoveryRate), pct(p.groups.B.recoveryRate)],
                  ...[...new Set([...Object.keys(p.groups.A.declineMix), ...Object.keys(p.groups.B.declineMix)])].sort().map((k) => [`Decline ${k}`, pct(p.groups.A.declineMix[k]), pct(p.groups.B.declineMix[k])]),
                  ...[...new Set([...Object.keys(p.groups.A.planMix), ...Object.keys(p.groups.B.planMix)])].sort().map((k) => [`Plan: ${k}`, pct(p.groups.A.planMix[k]), pct(p.groups.B.planMix[k])]),
                ].map(([l, a, b]) => (
                  <tr key={l} className="border-t border-line"><td className="py-1.5 text-muted">{l}</td><td>{a}</td><td>{b}</td></tr>
                ))}
              </tbody>
            </table>
            {p.warnings.length ? (
              <div className="rounded-xl bg-warn-bg p-4 text-sm text-warn" role="status">
                <p className="font-semibold">Groups differ by more than 5 pp</p>
                <ul className="mt-1 list-disc pl-5">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                <p className="mt-2 text-xs">Reshuffle to draw a new random split, or continue; the report will note the imbalance.</p>
                <button className="mt-3 rounded-full border-2 border-warn px-4 py-1.5 text-xs font-semibold" onClick={() => update({ reshuffle: true } as Partial<Trial>, 0)}>Reshuffle groups</button>
              </div>
            ) : (
              <p className="rounded-xl bg-ok-bg p-4 text-sm font-semibold text-ok" role="status">✓ Groups are balanced (every difference is within 5 pp).</p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-action">Excluded from the trial ({p.excluded.reduce((s, e) => s + e.count, 0)} hard declines)</summary>
              <ul className="mt-2 grid gap-1">
                {p.excluded.map((e) => (
                  <li key={e.code} className="flex justify-between border-t border-line pt-1"><span>{e.code} · {e.name}</span><span>{e.count} · {money(e.amount)}</span></li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">Hard declines can&apos;t succeed on retry, so neither route retries them.</p>
            </details>
            <div className="grid grid-cols-2 gap-3">
              <button className={secondary} onClick={() => setStep(0)}>Back</button>
              <button className={primary} onClick={() => setStep(2)}>Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-5">
            <fieldset className="grid gap-3 rounded-xl bg-page p-4 text-sm">
              <legend className="sr-only">Early-stop rules</legend>
              <p className="font-semibold text-navy">Early-stop rules</p>
              <label className="flex gap-3">
                <input type="checkbox" className="mt-0.5 size-4" checked={t.earlyStop.stopIfBWorse} onChange={(e) => update({ earlyStop: { ...t.earlyStop, stopIfBWorse: e.target.checked } }, 0)} />
                Stop if Route B recovers significantly less than Route A (p &lt; 0.05)
              </label>
              <label className="flex items-center gap-3">
                Stop after
                <input type="number" min={0} max={1000} className="w-20 rounded-lg border border-line bg-card px-2 py-1" value={t.earlyStop.maxComplaints} onChange={(e) => update({ earlyStop: { ...t.earlyStop, maxComplaints: +e.target.value } })} />
                customer complaints
              </label>
            </fieldset>
            <fieldset className="grid gap-3 text-sm">
              <legend className="mb-2 font-semibold text-navy">Readiness checklist</legend>
              {READINESS.map((r) => (
                <label key={r.key} className="flex gap-3">
                  <input type="checkbox" className="mt-0.5 size-4" checked={t.readiness[r.key]} onChange={(e) => update({ readiness: { ...t.readiness, [r.key]: e.target.checked } }, 0)} />
                  {r.label}
                </label>
              ))}
            </fieldset>
            {(startError || missing.length > 0) && (
              <p className="text-xs text-muted" role="status">{startError ?? `Still needed: ${missing.join("; ")}`}</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button className={secondary} onClick={() => setStep(1)}>Back</button>
              <span title={missing.length ? `Still needed: ${missing.join("; ")}` : "Start the trial"}>
                <button className={primary} disabled={missing.length > 0} onClick={start}>Start trial</button>
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
