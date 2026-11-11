"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayEvent } from "@/lib/run/engine";
import type { RunState } from "@/lib/run/runner";
import type { Trial, TrialPreview } from "@/lib/trial";

// Chart colours read the design tokens in globals.css.
const C = { navy: "var(--color-navy)", action: "var(--color-action)" };
const card = "rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-sm";
const primary = "rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-full border-2 border-action px-6 py-2.5 font-semibold text-action hover:bg-action/5";
const pct = (x: number, n: number) => (n ? `${((x / n) * 100).toFixed(1)}%` : "—");

type Assumptions = {
  routeA: { retryEveryDays: number; maxRetries: number };
  routeB: { afterPaydayRetryDays: number; insufficientFundsFallbackDays: number[]; networkRetryDays: number[]; otherSoftRetryDays: number[] };
  paydays: number[];
  insufficientFunds: { onPayday: number; afterPayday: number; afterPaydayDays: number; otherDay: number; decayPerFailedRetry: number };
  otherCodes: { code: string; retrySuccess: number }[];
  renewalFailureRate: number;
};
type Payload = { trial: Trial | null; state: RunState; active: boolean; assumptions: Assumptions };
type View = { kind: "loading" } | { kind: "error"; msg: string } | { kind: "ok"; data: Payload };

const STATUS: Record<RunState["status"], { label: string; tone: string }> = {
  idle: { label: "Ready to run", tone: "bg-page text-ink" },
  preparing: { label: "Loading customers", tone: "bg-warn-bg text-warn" },
  running: { label: "Running", tone: "bg-warn-bg text-warn" },
  pausing: { label: "Pausing at the end of the day", tone: "bg-warn-bg text-warn" },
  paused: { label: "Paused", tone: "bg-page text-ink" },
  error: { label: "Stopped on an error", tone: "bg-bad-bg text-bad" },
  stopped: { label: "Stopped early", tone: "bg-bad-bg text-bad" },
  complete: { label: "Complete", tone: "bg-ok-bg text-ok" },
};

function RouteTimeline({ route, name, days, enrollDays, yMax }: { route: "A" | "B"; name: string; days: DayEvent[]; enrollDays: number; yMax: number }) {
  const last = days[days.length - 1];
  const c = last?.cumulative;
  const data = days.map((d) => ({ day: d.day + 1, attempts: d.newFailures[route] + d.excluded[route] + d.retries[route], collected: d.collected[route] }));
  const totalAttempts = data.reduce((s, d) => s + d.attempts, 0);
  return (
    <section className={card} aria-labelledby={`route-${route}`}>
      <h3 id={`route-${route}`} className="text-lg font-semibold text-navy">
        Route {route} · {name}
      </h3>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted" title="Soft-decline failed renewals on this route so far">Failed invoices</dt>
          <dd className="text-2xl font-semibold">{c?.eligible[route] ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted" title="Invoices collected so far, before every recovery window has closed">Collected so far</dt>
          <dd className="text-2xl font-semibold">{c?.collected[route] ?? 0}</dd>
        </div>
        <div>
          <dt className="text-muted">Retries sent</dt>
          <dd className="text-2xl font-semibold">{c?.retries[route] ?? 0}</dd>
        </div>
      </dl>
      <div className="mt-4 h-40" role="img" aria-label={`Route ${route}: ${totalAttempts} sandbox attempts over ${days.length} simulated days, ${c?.collected[route] ?? 0} collected.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -20, right: 8 }}>
            <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={4} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} domain={[0, yMax]} />
            <Tooltip formatter={(v, k) => [v, k === "attempts" ? "Attempts" : "Collected"]} labelFormatter={(d) => `Day ${d}`} />
            <ReferenceLine x={enrollDays} stroke={C.navy} strokeDasharray="4 3" />
            <Bar dataKey="attempts" fill={route === "A" ? C.navy : C.action} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-muted">Attempts per simulated day, on the same scale for both routes. Dashed line: the last day new failures join; recovery continues after it.</p>
    </section>
  );
}

export default function TrialRun({ trial, preview, onDiscard }: { trial: Trial; preview: TrialPreview; onDiscard: () => void }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval>>(undefined);

  const load = useCallback(async () => {
    try {
      const data = (await (await fetch("/api/trial/run")).json()) as Payload;
      setView({ kind: "ok", data });
      return data;
    } catch (e) {
      setView({ kind: "error", msg: (e as Error).message });
    }
  }, []);

  // A run started elsewhere (another tab, or before a reload) is followed by polling.
  useEffect(() => {
    load().then((d) => {
      if (d?.active) poll.current = setInterval(async () => (await load())?.active || clearInterval(poll.current), 1000);
    });
    return () => clearInterval(poll.current);
  }, [load]);

  const patch = (state: RunState) => setView((v) => (v.kind === "ok" ? { kind: "ok", data: { ...v.data, state } } : v));

  async function fastForward() {
    setBusy(true);
    try {
      const res = await fetch("/api/trial/run", { method: "POST" });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        if (json.state) patch(json.state);
        setView((v) => (v.kind === "ok" ? v : { kind: "error", msg: json.error ?? "Couldn't start the run." }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const e = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (e.type === "state") patch(e.state);
        }
      }
    } catch {
      // The stream dropped; the run continues on the server, so follow it by polling.
      poll.current = setInterval(async () => (await load())?.active || clearInterval(poll.current), 1000);
    } finally {
      setBusy(false);
      load();
    }
  }

  async function post(path: string) {
    const res = await fetch(path, { method: "POST" });
    patch((await res.json()).state);
  }

  if (view.kind === "loading")
    return (
      <div aria-busy="true" aria-label="Loading the trial run" className="grid animate-pulse gap-4">
        <div className="h-10 w-1/3 rounded bg-line" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-72 rounded-[16px] bg-line" />
          <div className="h-72 rounded-[16px] bg-line" />
        </div>
      </div>
    );
  if (view.kind === "error")
    return (
      <div className={`${card} mx-auto max-w-[480px]`} role="alert">
        <p className="text-sm font-semibold text-bad">Couldn&apos;t load the trial run</p>
        <p className="mt-2 text-sm text-muted">{view.msg}</p>
        <button onClick={load} className={`${primary} mt-6 w-full`}>Try again</button>
      </div>
    );

  const { state: s, assumptions: a } = view.data;
  const total = s.totalDays || trial.lengthDays + trial.recoveryWindowDays;
  const doneDays = Math.min(s.nextDay, total);
  const running = ["preparing", "running", "pausing"].includes(s.status);
  const finished = s.status === "complete" || s.status === "stopped";
  const tag = STATUS[s.status];
  const attempts = (d: DayEvent, r: "A" | "B") => d.newFailures[r] + d.excluded[r] + d.retries[r];
  const yMax = Math.max(1, ...s.days.map((d) => Math.max(attempts(d, "A"), attempts(d, "B"))));

  return (
    <section className="grid gap-6" aria-labelledby="run-h">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="run-h" className="text-4xl font-light text-navy">Trial run</h1>
          <p className="mt-2 text-muted">
            {trial.lengthDays} days of new failures, then {trial.recoveryWindowDays} days to recover each one: {total} simulated days in all.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-3 py-1 font-semibold ${tag.tone}`} role="status" aria-live="polite">
            {tag.label}
            {running || s.status === "paused" ? ` · day ${doneDays} of ${total}` : ""}
          </span>
          {s.gateway && (
            <span className="rounded-full border border-line bg-card px-3 py-1 text-muted">
              {s.gateway === "standin" ? "Stand-in gateway, not Braintree" : "Braintree sandbox"}
            </span>
          )}
        </div>
      </header>

      <div className={`${card} grid gap-4`}>
        <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneDays} aria-label="Simulated days completed">
          <div className="h-full bg-action transition-all" style={{ width: `${(doneDays / total) * 100}%` }} />
        </div>
        {s.error && (
          <div role="alert" className="rounded-xl bg-bad-bg p-4 text-sm text-bad">
            <p className="font-semibold">{s.error.title}</p>
            <p className="mt-1">{s.error.fix}</p>
          </div>
        )}
        {s.stop && (
          <div role="alert" className="rounded-xl bg-bad-bg p-4 text-sm text-bad">
            <p className="font-semibold">Stopped on day {s.stop.day + 1}: {s.stop.rule}</p>
            <p className="mt-1">{s.stop.reason}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {s.status === "idle" && (
            <button className={primary} disabled={busy} onClick={fastForward}>Fast-forward {total} days</button>
          )}
          {(s.status === "paused" || s.status === "error") && (
            <button className={primary} disabled={busy} onClick={fastForward}>Resume from day {doneDays + 1}</button>
          )}
          {running && (
            <button className={secondary} disabled={s.status === "pausing"} onClick={() => post("/api/trial/run/pause")}>Pause</button>
          )}
          {finished && (
            <Link href="/results" className={primary}>See results</Link>
          )}
          {(finished || s.status === "paused" || s.status === "error") && (
            <button className={secondary} onClick={() => confirm("Reset the run? Its ledger is deleted and the trial runs again from day 1.") && post("/api/trial/run/reset")}>
              Reset run
            </button>
          )}
          {!running && (
            <button className="rounded-full px-4 py-2.5 font-semibold text-action" onClick={onDiscard}>Discard trial</button>
          )}
        </div>
      </div>

      {s.audit && (
        <section className={card} aria-labelledby="integrity-h">
          <h2 id="integrity-h" className="text-lg font-semibold text-navy">Run integrity</h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-muted" title="Invoices Braintree shows collected more than once. Must be 0.">Duplicate collections</dt>
              <dd className={`text-2xl font-semibold ${s.audit.gatewayDuplicates ? "text-bad" : "text-ok"}`}>{s.audit.gatewayDuplicates}</dd>
            </div>
            <div>
              <dt className="text-muted" title="Customers retried by both routes. Must be 0.">Customers on both routes</dt>
              <dd className={`text-2xl font-semibold ${s.audit.invoicesOnBothRoutes ? "text-bad" : "text-ok"}`}>{s.audit.invoicesOnBothRoutes}</dd>
            </div>
            <div>
              <dt className="text-muted">Sandbox calls</dt>
              <dd className="text-2xl font-semibold">{s.audit.sales.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt className="text-muted" title="Sandbox data carries no complaints, so this stays 0.">Complaints</dt>
              <dd className="text-2xl font-semibold">{s.audit.complaints} <span className="text-sm font-normal text-muted">of {s.audit.maxComplaints} allowed</span></dd>
            </div>
          </dl>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <RouteTimeline route="A" name={`Current · ${preview.groups.A.customers.toLocaleString("en-US")} customers`} days={s.days} enrollDays={trial.lengthDays} yMax={yMax} />
        <RouteTimeline route="B" name={`PayPal · ${preview.groups.B.customers.toLocaleString("en-US")} customers`} days={s.days} enrollDays={trial.lengthDays} yMax={yMax} />
      </div>
      {s.days.length > 0 && (
        <p className="text-sm text-muted">
          Collected so far: Route A {pct(s.days[s.days.length - 1].cumulative.collected.A, s.days[s.days.length - 1].cumulative.eligible.A)}, Route B{" "}
          {pct(s.days[s.days.length - 1].cumulative.collected.B, s.days[s.days.length - 1].cumulative.eligible.B)}. These count invoices whose window is still open;
          the report counts only closed ones.
        </p>
      )}

      <details className={`${card} text-sm`}>
        <summary className="cursor-pointer font-semibold text-action">What&apos;s simulated: the outcome model&apos;s assumptions</summary>
        <div className="mt-3 grid gap-2 text-muted">
          <p>Every sale is a real sandbox call. Whether it succeeds is picked by this documented model, then sent as the matching test amount. The model takes no route, so any difference comes from when each route retries.</p>
          <ul className="list-disc pl-5">
            <li>Route A (current): retry every {a.routeA.retryEveryDays} days, up to {a.routeA.maxRetries} times, for every decline code.</li>
            <li>Route B (PayPal): no retry after a hard decline; insufficient funds waits for a payday ({a.paydays.join(" and ")} of the month) and tries again {a.routeB.afterPaydayRetryDays} days later; network errors retry after {a.routeB.networkRetryDays.join(", ")} days; other soft declines after {a.routeB.otherSoftRetryDays.join(", ")} days. Same maximum retries as Route A.</li>
            <li>2001 · Insufficient funds: {a.insufficientFunds.onPayday * 100}% chance on a payday, {a.insufficientFunds.otherDay * 100}% on other days, × {a.insufficientFunds.decayPerFailedRetry} after each failed retry.</li>
            <li>Other soft codes, every retry: {a.otherCodes.filter((c) => c.retrySuccess > 0 && c.code !== "2001").map((c) => `${c.code}: ${(c.retrySuccess * 100).toFixed(0)}%`).join(", ")}.</li>
            <li>{(a.renewalFailureRate * 100).toFixed(0)}% of renewals fail, with the seeded decline mix.</li>
          </ul>
          <p>
            Set in <code>config/seed.config.ts</code> (<code>trialModel</code>).
          </p>
        </div>
      </details>
    </section>
  );
}
