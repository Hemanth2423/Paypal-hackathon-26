"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import type { Invoice } from "@/lib/diagnostic";
import type { FinalReport, ProgressReport, RouteMetrics } from "@/lib/results/report";
import { templateSupport, verdictSentence } from "@/lib/results/summary-template";
import type { Summary } from "@/lib/analyst/analyst";

ModuleRegistry.registerModules([AllCommunityModule]);

const card = "rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-sm print:p-3";
const primary = "rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-full border-2 border-action bg-card px-5 py-2.5 text-center font-semibold text-action hover:bg-action/5";
const money = (n: number, dp = 2) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const signedMoney = (n: number, dp = 2) => `${n > 0 ? "+" : ""}${money(n, dp)}`;
const pct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const pp = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pp`);

// Metric definitions, from Product.md §6.
const DEF = {
  eligible: "Eligible failure: a failed renewal with a soft (retryable) decline, whose first failure falls inside the trial window and whose recovery window has closed.",
  recovered: "Recovered: collected within the recovery window by the customer's assigned route.",
  rate: "Recovery rate = recovered ÷ eligible, per route.",
  recoveredAmount: "Recovered $: the invoice amounts collected.",
  fees: "Network excess-retry fees for retries past the card network's limit. The trial has no per-retry cost.",
  refunds: "Refunds and chargebacks in the window.",
  net: "Net recovered $ = recovered $ − retry costs − network excess-retry fees − refunds.",
  saved: "Saved subscriptions: recovered invoices whose subscription is still active at the end of the window.",
  uplift: "Uplift = Route B recovery rate − Route A recovery rate.",
  ci: "95% confidence interval for the uplift (Newcombe's hybrid score method).",
  p: "Two-sided p-value from a two-proportion z-test.",
};

type Payload = { empty: true } | (FinalReport & { runId: string }) | (ProgressReport & { runId: string });
type View = { kind: "loading" } | { kind: "error"; msg: string } | { kind: "ok"; data: Payload };
type Filter = { route?: string; reason?: string; status?: string };

const qs = (f: Filter) => new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();

const VERDICT_TONE: Record<string, string> = { paypal_wins: "bg-ok-bg text-ok", current_wins: "bg-bad-bg text-bad", inconclusive: "bg-warn-bg text-warn" };

export default function Results() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>({});
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setFilter({ route: sp.get("route") ?? undefined, reason: sp.get("reason") ?? undefined, status: sp.get("status") ?? undefined });
  }, []);
  const applyFilter = (f: Filter) => {
    setFilter(f);
    window.history.replaceState(null, "", `/results${qs(f) ? `?${qs(f)}` : ""}`);
    document.getElementById("invoices")?.scrollIntoView({ behavior: "smooth" });
  };

  const load = useCallback(async () => {
    try {
      setView({ kind: "ok", data: (await (await fetch("/api/results")).json()) as Payload });
    } catch (e) {
      setView({ kind: "error", msg: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // The AI summary loads separately, so the report never waits on AI.
  const final = view.kind === "ok" && !("empty" in view.data) && view.data.kind === "final" ? view.data.runId : null;
  useEffect(() => {
    if (!final) return;
    fetch("/api/results/summary")
      .then((r) => r.json())
      .then((s) => !s.empty && setSummary(s))
      .catch(() => undefined);
  }, [final]);

  const rows = useMemo(() => {
    if (view.kind !== "ok" || "empty" in view.data) return [];
    return view.data.invoices.filter(
      (i) => (!filter.route || i.route === filter.route) && (!filter.reason || i.firstCode === filter.reason) && (!filter.status || i.status === filter.status),
    );
  }, [view, filter]);

  const cols = useMemo<ColDef<Invoice>[]>(
    () => [
      { field: "invoiceId", headerName: "Invoice", minWidth: 190, flex: 1 },
      { field: "route", headerName: "Route", width: 90 },
      { field: "billingDate", headerName: "First failed", width: 120 },
      { field: "amount", headerName: "Amount", width: 110, valueFormatter: (p) => money(p.value), type: "rightAligned" },
      { headerName: "Decline", valueGetter: (p) => `${p.data!.firstCode} · ${p.data!.declineName}`, minWidth: 200, flex: 1 },
      { headerName: "Attempts", valueGetter: (p) => p.data!.attempts.length, width: 100, type: "rightAligned" },
      {
        field: "status",
        headerName: "Status",
        width: 130,
        cellRenderer: (p: { value: string }) => {
          const s = { recovered: "bg-ok-bg text-ok", unrecovered: "bg-bad-bg text-bad", in_window: "bg-warn-bg text-warn" }[p.value];
          return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s}`}>{p.value.replace("_", " ")}</span>;
        },
      },
      { field: "daysToRecover", headerName: "Days to recover", width: 140, type: "rightAligned" },
    ],
    [],
  );

  if (view.kind === "loading")
    return (
      <div aria-busy="true" aria-label="Loading results" className="grid animate-pulse gap-4">
        <div className="h-10 w-1/3 rounded bg-line" />
        <div className="h-40 rounded-[16px] bg-line" />
        <div className="h-72 rounded-[16px] bg-line" />
      </div>
    );
  if (view.kind === "error")
    return (
      <div className={`${card} mx-auto max-w-[480px]`} role="alert">
        <p className="text-sm font-semibold text-bad">Couldn&apos;t load the results</p>
        <p className="mt-2 text-sm text-muted">{view.msg}</p>
        <button onClick={load} className={`${primary} mt-6 w-full`}>Try again</button>
      </div>
    );

  const d = view.data;
  if ("empty" in d)
    return (
      <div className={`${card} mx-auto max-w-[480px] text-center`}>
        <h1 className="text-2xl font-light text-navy">No trial has run yet</h1>
        <p className="mt-2 text-sm text-muted">Set up and run the trial; its results appear here. If the app restarted, its run was cleared: run it again (about a minute).</p>
        <Link href="/trial" className={`${primary} mt-6 inline-block`}>Go to the trial</Link>
      </div>
    );

  const exportHref = `/api/results/export${qs(filter) ? `?${qs(filter)}` : ""}`;
  const filterChips = Object.entries(filter).filter(([, v]) => v);

  const invoiceTable = (
    <section id="invoices" className={`${card} print:hidden`} aria-labelledby="inv-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="inv-h" className="text-lg font-semibold text-navy">Failed invoices</h2>
          <p className="text-sm text-muted">
            {rows.length} of {d.invoices.length} shown{filterChips.length ? `, filtered by ${filterChips.map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {filterChips.length > 0 && (
            <button className="rounded-full px-4 py-2 text-sm font-semibold text-action" onClick={() => applyFilter({})}>Clear filters</button>
          )}
          <a href={exportHref} className={`${secondary} text-sm`}>Export CSV</a>
        </div>
      </div>
      <div className="mt-4 h-[420px]">
        <AgGridReact theme={themeQuartz} rowData={rows} columnDefs={cols} defaultColDef={{ sortable: true, filter: true, resizable: true }} pagination paginationPageSize={50} />
      </div>
    </section>
  );

  if (d.kind === "progress")
    return (
      <section className="grid gap-6" aria-labelledby="res-h">
        <header>
          <h1 id="res-h" className="text-4xl font-light text-navy">Results</h1>
          <p className="mt-2 text-muted">The trial is on simulated day {Math.min(d.day, d.totalDays)} of {d.totalDays}. The verdict appears when the run finishes.</p>
        </header>
        <div className={`${card} flex flex-wrap items-center justify-between gap-4`} role="status">
          <p className="text-sm text-muted">Invoices still inside their recovery window are marked “in window”. No verdict, summary or PDF until every window has closed.</p>
          <div className="flex gap-2">
            <Link href="/trial" className={secondary}>Back to the run</Link>
            <button className={primary} disabled title="The PDF is available when the run finishes">Print / save PDF</button>
          </div>
        </div>
        {invoiceTable}
      </section>
    );

  const r = d;
  const { A, B } = r.routes;
  const link = (f: Filter, text: string) => (
    <button className="font-semibold text-action underline-offset-2 hover:underline print:no-underline print:text-ink" onClick={() => applyFilter(f)}>
      {text}
    </button>
  );
  const row = (label: string, def: string, get: (m: RouteMetrics) => string, diff: string, f?: Filter) => (
    <tr className="border-t border-line">
      <th scope="row" className="py-2.5 pr-4 text-left font-normal text-muted" title={def}>
        {label} <span aria-hidden>ⓘ</span>
      </th>
      <td className="py-2.5 pr-4 text-right">{f ? link({ ...f, route: "A" }, get(A)) : get(A)}</td>
      <td className="py-2.5 pr-4 text-right">{f ? link({ ...f, route: "B" }, get(B)) : get(B)}</td>
      <td className="py-2.5 text-right font-semibold">{diff}</td>
    </tr>
  );
  const net = r.netDifferenceScaled ?? 0;

  return (
    <section className="grid gap-6 print:gap-3" aria-labelledby="res-h">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="res-h" className="text-4xl font-light text-navy">Results</h1>
          <p className="mt-2 text-muted">Route A (current process) vs Route B (PayPal), on failed invoices whose recovery window closed by {r.asOf}.</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a href="/what-if" className={secondary}>What-if: try your policy</a>
          <a href={exportHref} className={secondary}>Export CSV</a>
          <button className={primary} onClick={() => window.print()}>Print / save PDF</button>
        </div>
      </header>

      <section data-print-card className={`${card} grid gap-3`} aria-labelledby="verdict-h">
        <p className={`w-fit rounded-full px-3 py-1 text-sm font-semibold ${VERDICT_TONE[r.verdict.verdict]}`}>Verdict</p>
        <h2 id="verdict-h" className="text-3xl font-semibold text-ink">{r.verdict.label}</h2>
        <p className="text-lg text-ink">
          {net === 0 ? "No difference in net recovered revenue." : `${signedMoney(net, 0)} net recovered revenue for the PayPal route`}{" "}
          <span className="text-sm text-muted">
            ({signedMoney(r.netPerInvoiceDifference ?? 0)} per eligible invoice × {A.eligible + B.eligible} invoices)
          </span>
        </p>
        <p className="text-sm text-muted">{r.verdict.reason}</p>
        {r.verdict.verdict === "inconclusive" && r.settleSample != null && (
          <p className="text-sm text-muted">To detect an uplift this size at 80% power, the trial needs about {r.settleSample.toLocaleString("en-US")} eligible invoices per route; it has {Math.min(A.eligible, B.eligible)}.</p>
        )}
        {r.stoppedEarly && (
          <p role="alert" className="rounded-xl bg-bad-bg p-3 text-sm text-bad">
            The trial stopped early on day {r.stoppedEarly.day + 1}: {r.stoppedEarly.rule}. These results cover only invoices whose window had closed.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] print:grid-cols-[1fr_30%] print:gap-3">
        <div className="grid min-w-0 gap-6 print:gap-3">
          <section data-print-card className={card} aria-labelledby="table-h">
            <h2 id="table-h" className="text-lg font-semibold text-navy">Side by side</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted">
                    <th scope="col" className="pb-2 text-left font-normal">Metric</th>
                    <th scope="col" className="pb-2 pr-4 text-right font-semibold text-navy">Route A · Current</th>
                    <th scope="col" className="pb-2 pr-4 text-right font-semibold text-navy">Route B · PayPal</th>
                    <th scope="col" className="pb-2 text-right font-normal">B − A</th>
                  </tr>
                </thead>
                <tbody>
                  {row("Eligible failures", DEF.eligible, (m) => String(m.eligible), String(B.eligible - A.eligible), {})}
                  {row("Recovered", DEF.recovered, (m) => String(m.recovered), String(B.recovered - A.recovered), { status: "recovered" })}
                  {row("Recovery rate", DEF.rate, (m) => pct(m.recoveryRate), pp(r.uplift))}
                  {row("Recovered $", DEF.recoveredAmount, (m) => money(m.recoveredAmount), signedMoney(B.recoveredAmount - A.recoveredAmount), { status: "recovered" })}
                  {row("Costs and fees", DEF.fees, (m) => money(m.costsAndFees), signedMoney(B.costsAndFees - A.costsAndFees))}
                  {row("Refunds", DEF.refunds, (m) => money(m.refunds), signedMoney(B.refunds - A.refunds))}
                  {row("Net recovered $", DEF.net, (m) => money(m.net), signedMoney(B.net - A.net))}
                  {row("Net $ per eligible invoice", DEF.net, (m) => (m.netPerEligible == null ? "—" : money(m.netPerEligible)), signedMoney(r.netPerInvoiceDifference ?? 0))}
                  {row("Saved subscriptions", DEF.saved, (m) => String(m.savedSubscriptions), String(B.savedSubscriptions - A.savedSubscriptions))}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm md:grid-cols-4">
              <div title={DEF.uplift}>
                <dt className="text-muted">Uplift</dt>
                <dd className="text-xl font-semibold">{pp(r.uplift)}</dd>
              </div>
              <div title="Uplift as a share of Route A's recovery rate">
                <dt className="text-muted">Relative uplift</dt>
                <dd className="text-xl font-semibold">{r.relativeUplift == null ? "—" : `${r.relativeUplift >= 0 ? "+" : ""}${(r.relativeUplift * 100).toFixed(1)}%`}</dd>
              </div>
              <div title={DEF.ci}>
                <dt className="text-muted">95% CI</dt>
                <dd className="text-xl font-semibold">{pp(r.ci95?.low)} to {pp(r.ci95?.high)}</dd>
              </div>
              <div title={DEF.p}>
                <dt className="text-muted">p-value</dt>
                <dd className="text-xl font-semibold">{r.pValue == null ? "—" : r.pValue < 0.001 ? "< 0.001" : r.pValue.toFixed(3)}</dd>
              </div>
            </dl>
          </section>

          <section data-print-card className={card} aria-labelledby="reason-h">
            <h2 id="reason-h" className="text-lg font-semibold text-navy">Where the difference came from</h2>
            <p className="text-sm text-muted">The same comparison within each decline reason. Click a reason to see its invoices.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted">
                    <th scope="col" className="pb-2 text-left font-normal">Decline reason</th>
                    <th scope="col" className="pb-2 pr-4 text-right font-normal">Invoices A / B</th>
                    <th scope="col" className="pb-2 pr-4 text-right font-normal">Route A</th>
                    <th scope="col" className="pb-2 pr-4 text-right font-normal">Route B</th>
                    <th scope="col" className="pb-2 text-right font-normal">Uplift</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byReason.map((x) => (
                    <tr key={x.code} className="border-t border-line">
                      <th scope="row" className="py-2.5 pr-4 text-left font-normal">{link({ reason: x.code }, x.label)}</th>
                      <td className="py-2.5 pr-4 text-right">{x.routes.A.eligible} / {x.routes.B.eligible}</td>
                      <td className="py-2.5 pr-4 text-right">{pct(x.routes.A.recoveryRate)}</td>
                      <td className="py-2.5 pr-4 text-right">{pct(x.routes.B.recoveryRate)}</td>
                      <td className="py-2.5 text-right font-semibold">{pp(x.uplift)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-6 print:gap-3">
          <section data-print-card className={card} aria-labelledby="summary-h">
            <h2 id="summary-h" className="text-lg font-semibold text-navy">Summary</h2>
            <div className="mt-2 grid gap-2 text-sm" data-summary>
              {[summary?.verdict ?? verdictSentence(r), ...(summary?.support ?? templateSupport(r))].map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {summary?.source === "ai"
                ? "Written by the AI analyst and checked against these figures. The verdict sentence comes from the rules."
                : `Template summary${summary?.note ? ` (${summary.note})` : ""}. The verdict sentence comes from the rules.`}
            </p>
          </section>
          <section data-print-card className={card} aria-labelledby="excl-h">
            <h2 id="excl-h" className="text-lg font-semibold text-navy">Excluded from the trial</h2>
            <p className="text-sm text-muted">Hard declines can&apos;t succeed on retry, so neither route retried them.</p>
            <ul className="mt-3 grid gap-1 text-sm">
              {r.excluded.map((e) => (
                <li key={e.code} className="flex justify-between border-t border-line pt-1">
                  <span>{e.code} · {e.name}</span>
                  <span>{e.count} · {money(e.amount)}</span>
                </li>
              ))}
              {!r.excluded.length && <li className="text-muted">None</li>}
            </ul>
          </section>
          <section data-print-card className={`${card} text-sm`} aria-labelledby="real-h">
            <h2 id="real-h" className="text-lg font-semibold text-navy">What&apos;s real, what&apos;s simulated</h2>
            <p className="mt-2">
              <strong>Real:</strong> {r.dataSource === "standin" ? "nothing in this run; it used the stand-in gateway, not Braintree." : "every customer, card and payment attempt is a Braintree sandbox transaction."}
            </p>
            <p className="mt-1">
              <strong>Simulated:</strong> the bank&apos;s decisions (a documented outcome model picks each one), Route B&apos;s retry timing (a Smart Retries–style policy), and the calendar.
            </p>
          </section>
        </aside>
      </div>

      {invoiceTable}
    </section>
  );
}
