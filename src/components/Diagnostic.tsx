"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Diagnostic as DiagnosticData, Invoice } from "@/lib/diagnostic";
import { ALL_RULES } from "@/lib/declines";

ModuleRegistry.registerModules([AllCommunityModule]);

type Data = DiagnosticData & {
  syncedAt: string;
  options: { reasons: [string, string][]; brands: string[]; plans: string[]; minDate: string; maxDate: string };
};
type Filters = { from?: string; to?: string; reason?: string; brand?: string; plan?: string };
type TableKey = "reason" | "type" | "status" | "brand" | "plan";
type TableFilter = Partial<Record<TableKey, string>>;

const C = { navy: "#142c8e", action: "#0070e0", soft: "#0070e0", hard: "#b3261e", line: "#dfe1e6" };
const card = "rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-sm";
const money = (n: number, dp = 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const qs = (o: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();

const DEFS = {
  failed: "Total amount of renewal invoices whose first charge failed, in the selected range.",
  recoverable: "Failed revenue from soft (retryable) declines, e.g. insufficient funds.",
  rate: "Recovered ÷ soft-decline invoices whose 14-day recovery window has closed.",
  hard: "Failed revenue from hard declines (e.g. expired card). Retrying these can't succeed.",
};

function Delta({ now, prev, isRate }: { now: number | null; prev: number | null; isRate?: boolean }) {
  if (now == null || prev == null || (!isRate && prev === 0)) return <span className="text-xs text-muted">No prior-30-day data</span>;
  const d = isRate ? (now - prev) * 100 : ((now - prev) / prev) * 100;
  return (
    <span className="text-xs text-muted">
      {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}
      {isRate ? " pp" : "%"} last 30 days vs prior 30
    </span>
  );
}

function Kpi(p: { label: string; value: string; def: string; delta: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={p.onClick}
      title={p.def}
      className={`${card} text-left transition hover:border-action ${p.active ? "border-action ring-2 ring-action/30" : ""}`}
    >
      <p className="text-sm text-muted">
        {p.label} <span aria-hidden>ⓘ</span>
      </p>
      <p className="mt-1 text-3xl font-semibold text-ink">{p.value}</p>
      <div className="mt-2">{p.delta}</div>
    </button>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading diagnostic" className="grid animate-pulse gap-4">
      <div className="h-10 w-1/3 rounded bg-line" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-[16px] bg-line" />
        ))}
      </div>
      <div className="h-72 rounded-[16px] bg-line" />
    </div>
  );
}

export default function Diagnostic() {
  const [filters, setFilters] = useState<Filters>({});
  const [table, setTable] = useState<TableFilter>({});
  const [groupBy, setGroupBy] = useState<"" | TableKey>("");
  const [state, setState] = useState<{ kind: "loading" } | { kind: "empty" } | { kind: "error"; msg: string } | { kind: "ok"; data: Data }>({ kind: "loading" });
  const [summary, setSummary] = useState<{ reasons: string[]; stake: string; source: string; note?: string } | null>(null);
  const [selected, setSelected] = useState<Invoice | null>(null);

  const load = useCallback(async () => {
    setState((s) => (s.kind === "ok" ? s : { kind: "loading" }));
    try {
      const res = await fetch(`/api/diagnostic?${qs(filters)}`);
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const json = await res.json();
      setState(json.empty ? { kind: "empty" } : { kind: "ok", data: json });
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/diagnostic/summary")
      .then((r) => r.json())
      .then((j) => setSummary(j.empty ? null : j))
      .catch(() => setSummary({ reasons: [], stake: "", source: "error", note: "Couldn't load the summary" }));
  }, []);

  const rows = useMemo(() => {
    if (state.kind !== "ok") return [];
    return state.data.rows.filter(
      (r) =>
        (!table.reason || r.firstCode === table.reason) &&
        (!table.type || r.declineType === table.type) &&
        (!table.status || r.status === table.status) &&
        (!table.brand || r.cardBrand === table.brand) &&
        (!table.plan || r.planId === table.plan),
    );
  }, [state, table]);

  const groups = useMemo(() => {
    if (!groupBy) return [];
    const keyOf = (r: Invoice) =>
      ({ reason: `${r.firstCode} · ${r.declineName}`, type: r.declineType, status: r.status, brand: r.cardBrand, plan: r.planId })[groupBy];
    const valueOf = (r: Invoice) => ({ reason: r.firstCode, type: r.declineType, status: r.status, brand: r.cardBrand, plan: r.planId })[groupBy];
    const m = new Map<string, { group: string; value: string; count: number; amount: number; recovered: number; decided: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      const g = m.get(k) ?? { group: k, value: valueOf(r), count: 0, amount: 0, recovered: 0, decided: 0 };
      g.count++;
      g.amount += r.amount;
      if (r.status !== "in_window") g.decided++;
      if (r.status === "recovered") g.recovered++;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, rate: g.decided ? g.recovered / g.decided : null })).sort((a, b) => b.amount - a.amount);
  }, [rows, groupBy]);

  const invoiceCols = useMemo<ColDef<Invoice>[]>(
    () => [
      { field: "invoiceId", headerName: "Invoice", width: 130 },
      { field: "billingDate", headerName: "Billing date", width: 120 },
      { field: "planId", headerName: "Plan", width: 100 },
      { field: "amount", headerName: "Amount", width: 100, valueFormatter: (p) => money(p.value, 2), type: "rightAligned" },
      { headerName: "Decline", valueGetter: (p) => `${p.data!.firstCode} · ${p.data!.declineName}`, flex: 1, minWidth: 200 },
      { field: "declineType", headerName: "Type", width: 90 },
      { field: "cardBrand", headerName: "Card", width: 120 },
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
    ],
    [],
  );

  const groupCols = useMemo<ColDef<(typeof groups)[number]>[]>(
    () => [
      { field: "group", headerName: "Group", flex: 1 },
      { field: "count", headerName: "Invoices", width: 110, type: "rightAligned" },
      { field: "amount", headerName: "Failed $", width: 130, valueFormatter: (p) => money(p.value, 2), type: "rightAligned" },
      { field: "rate", headerName: "Recovery rate", width: 140, valueFormatter: (p) => pct(p.value), type: "rightAligned" },
    ],
    [],
  );

  if (state.kind === "loading") return <Skeleton />;
  if (state.kind === "empty")
    return (
      <div className={`${card} mx-auto max-w-[480px] text-center`}>
        <h1 className="text-2xl font-light text-navy">No data to diagnose yet</h1>
        <p className="mt-2 text-sm text-muted">Connect your Braintree sandbox first, and we'll build the diagnostic from it.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-navy px-6 py-3 font-semibold text-white">
          Go to Connect
        </Link>
      </div>
    );
  if (state.kind === "error")
    return (
      <div className={`${card} mx-auto max-w-[480px]`} role="alert">
        <p className="text-sm font-semibold text-bad">Couldn't load the diagnostic</p>
        <p className="mt-2 text-sm text-muted">{state.msg}</p>
        <button onClick={load} className="mt-6 w-full rounded-full bg-navy px-6 py-3 font-semibold text-white">
          Try again
        </button>
      </div>
    );

  const d = state.data;
  const k = d.kpis;
  const setT = (key: TableKey, value?: string) => setTable(value ? { [key]: value } : {});
  const exportHref = `/api/diagnostic/export?${qs({ ...filters, ...table })}`;
  const chartData = d.reasons.map((r) => ({ ...r, label: `${r.code} · ${r.name}` }));
  const select = "rounded-lg border border-line bg-card px-3 py-2 text-sm";

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-light text-navy">Where your renewals leak money</h1>
          <p className="mt-1 text-muted">
            {d.rowCount.toLocaleString()} failed renewals · synced {new Date(d.syncedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
          <label className="text-sm">
            <span className="sr-only">From</span>
            <input type="date" className={select} min={d.options.minDate} max={d.options.maxDate} value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })} />
          </label>
          <label className="text-sm">
            <span className="sr-only">To</span>
            <input type="date" className={select} min={d.options.minDate} max={d.options.maxDate} value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })} />
          </label>
          <select aria-label="Decline reason" className={select} value={filters.reason ?? ""} onChange={(e) => setFilters({ ...filters, reason: e.target.value || undefined })}>
            <option value="">All decline reasons</option>
            {d.options.reasons.map(([c, n]) => (
              <option key={c} value={c}>{`${c} · ${n}`}</option>
            ))}
          </select>
          <select aria-label="Card brand" className={select} value={filters.brand ?? ""} onChange={(e) => setFilters({ ...filters, brand: e.target.value || undefined })}>
            <option value="">All card brands</option>
            {d.options.brands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <select aria-label="Plan" className={select} value={filters.plan ?? ""} onChange={(e) => setFilters({ ...filters, plan: e.target.value || undefined })}>
            <option value="">All plans</option>
            {d.options.plans.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          {(Object.values(filters).some(Boolean) || Object.keys(table).length > 0) && (
            <button className="rounded-full px-4 py-2 text-sm font-semibold text-action" onClick={() => (setFilters({}), setTable({}))}>
              Clear all
            </button>
          )}
        </div>
      </header>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Failed revenue" value={money(k.failedRevenue)} def={DEFS.failed} active={!Object.keys(table).length} onClick={() => setTable({})} delta={<Delta now={k.last30.failedRevenue} prev={k.prior30.failedRevenue} />} />
        <Kpi label="Recoverable revenue" value={money(k.recoverableRevenue)} def={DEFS.recoverable} active={table.type === "soft"} onClick={() => setT("type", "soft")} delta={<Delta now={k.last30.recoverableRevenue} prev={k.prior30.recoverableRevenue} />} />
        <Kpi label="Current recovery rate" value={pct(k.recoveryRate)} def={DEFS.rate} active={table.status === "recovered"} onClick={() => setT("status", "recovered")} delta={<Delta now={k.last30.recoveryRate} prev={k.prior30.recoveryRate} isRate />} />
        <Kpi label="Lost to hard declines" value={money(k.hardRevenue)} def={DEFS.hard} active={table.type === "hard"} onClick={() => setT("type", "hard")} delta={<Delta now={k.last30.hardRevenue} prev={k.prior30.hardRevenue} />} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid min-w-0 gap-6">
          <section className={card} aria-labelledby="leak-h">
            <h2 id="leak-h" className="text-lg font-semibold text-navy">Where the money leaks</h2>
            <p className="text-sm text-muted">Failed revenue by decline reason. Click a bar to filter the table.</p>
            <div className="mt-4 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 120 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="label" width={210} tick={{ fontSize: 13, fill: "#1a1a1a" }} />
                  <Tooltip formatter={(v) => money(Number(v), 2)} />
                  <Bar dataKey="amount" radius={[0, 6, 6, 0]} cursor="pointer" isAnimationActive={false} onClick={(e) => setT("reason", (e as unknown as { code: string }).code)}>
                    {chartData.map((r) => (
                      <Cell key={r.code} fill={r.type === "hard" ? C.hard : C.soft} opacity={table.reason && table.reason !== r.code ? 0.35 : 1} />
                    ))}
                    <LabelList dataKey="amount" position="right" formatter={(v) => money(Number(v))} style={{ fontSize: 12, fill: "#1a1a1a" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted">
              <span className="mr-1 inline-block size-2.5 rounded-sm" style={{ background: C.soft }} /> Retryable (soft)
              <span className="ml-4 mr-1 inline-block size-2.5 rounded-sm" style={{ background: C.hard }} /> Not retryable (hard)
            </p>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section className={card} aria-labelledby="split-h">
              <h2 id="split-h" className="text-lg font-semibold text-navy">Recoverable vs. not</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <button className="text-left" onClick={() => setT("type", "soft")}>
                  <dt className="text-sm text-muted">Retryable (soft)</dt>
                  <dd className="text-2xl font-semibold">{money(d.split.soft.amount)}</dd>
                  <dd className="text-xs text-muted">{d.split.soft.count.toLocaleString()} invoices</dd>
                </button>
                <button className="text-left" onClick={() => setT("type", "hard")}>
                  <dt className="text-sm text-muted">Not retryable (hard)</dt>
                  <dd className="text-2xl font-semibold text-bad">{money(d.split.hard.amount)}</dd>
                  <dd className="text-xs text-muted">{d.split.hard.count.toLocaleString()} invoices</dd>
                </button>
              </dl>
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-semibold text-action">How we classify declines</summary>
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-muted">
                    <tr><th>Code</th><th>Type</th><th>Visa retry rule</th></tr>
                  </thead>
                  <tbody>
                    {ALL_RULES.map((r) => (
                      <tr key={r.code} className="border-t border-line">
                        <td className="py-1">{r.code} · {r.name}</td>
                        <td>{r.type}</td>
                        <td>{r.retryCap == null ? "No cap" : r.retryCap === 0 ? "Do not retry" : `Max ${r.retryCap} / 30 days`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">Source: Braintree decline guide and Visa retry categories.</p>
              </details>
            </section>

            <section className={card} aria-labelledby="waste-h">
              <h2 id="waste-h" className="text-lg font-semibold text-navy">Wasted retries</h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between"><dt>Hard declines that were retried</dt><dd className="font-semibold">{d.waste.hardInvoicesRetried.toLocaleString()}</dd></div>
                <div className="flex justify-between"><dt>Retries on hard declines</dt><dd className="font-semibold">{d.waste.hardRetries.toLocaleString()}</dd></div>
                <div className="flex justify-between"><dt>Retries over network limits</dt><dd className="font-semibold">{d.waste.retriesOverCap.toLocaleString()}</dd></div>
                <div className="flex justify-between border-t border-line pt-3"><dt>Estimated excess network fees</dt><dd className="font-semibold text-bad">{money(d.waste.excessFees, 2)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted">Fee estimate: $0.10 per retry over the Visa cap, applied to all cards.</p>
            </section>
          </div>

          <section className={card} aria-labelledby="perf-h">
            <h2 id="perf-h" className="text-lg font-semibold text-navy">How your current process performs</h2>
            <p className="text-sm text-muted">Recovery rate by decline reason, against your overall rate of {pct(d.overallRecoveryRate)} (all declines, hard included).</p>
            <ul className="mt-4 grid gap-3">
              {d.reasons.map((r) => {
                const below = r.recoveryRate != null && d.overallRecoveryRate != null && r.recoveryRate < d.overallRecoveryRate;
                return (
                  <li key={r.code}>
                    <button className="w-full text-left" onClick={() => setT("reason", r.code)}>
                      <div className="flex justify-between text-sm">
                        <span>{r.code} · {r.name}</span>
                        <span className={below ? "font-semibold text-bad" : "font-semibold"}>
                          {pct(r.recoveryRate)} {below && <span className="ml-1 rounded-full bg-bad-bg px-2 py-0.5 text-xs">Below average</span>}
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-line">
                        <div className="h-2 rounded-full" style={{ width: `${(r.recoveryRate ?? 0) * 100}%`, background: below ? C.hard : C.action }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className={card} aria-labelledby="table-h">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="table-h" className="text-lg font-semibold text-navy">Failed renewals</h2>
                <p className="text-sm text-muted" aria-live="polite">
                  {rows.length.toLocaleString()} invoices
                  {Object.entries(table).map(([key, v]) => (
                    <button key={key} onClick={() => setTable({})} className="ml-2 rounded-full bg-action/10 px-2 py-0.5 text-xs font-semibold text-action">
                      {key}: {v} ✕
                    </button>
                  ))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select aria-label="Group by" className={select} value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
                  <option value="">No grouping</option>
                  <option value="reason">Group by decline reason</option>
                  <option value="type">Group by soft / hard</option>
                  <option value="status">Group by status</option>
                  <option value="brand">Group by card brand</option>
                  <option value="plan">Group by plan</option>
                </select>
                <a href={exportHref} className="rounded-full border-2 border-action px-4 py-2 text-sm font-semibold text-action hover:bg-action/5">
                  Export CSV
                </a>
              </div>
            </div>
            <div className="mt-4 h-[460px]">
              {groupBy ? (
                <AgGridReact
                  key={`group-${groupBy}`}
                  theme={themeQuartz}
                  rowData={groups}
                  columnDefs={groupCols}
                  onRowClicked={(e) => (setTable({ [groupBy]: e.data!.value }), setGroupBy(""))}
                  rowStyle={{ cursor: "pointer" }}
                />
              ) : (
                <AgGridReact
                  key="invoices"
                  theme={themeQuartz}
                  rowData={rows}
                  columnDefs={invoiceCols}
                  defaultColDef={{ sortable: true, filter: true, resizable: true }}
                  pagination
                  paginationPageSize={50}
                  onRowClicked={(e) => setSelected(e.data ?? null)}
                  rowStyle={{ cursor: "pointer" }}
                />
              )}
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-6">
          <section className={card} aria-labelledby="ai-h">
            <h2 id="ai-h" className="text-lg font-semibold text-navy">AI summary</h2>
            {!summary ? (
              <div className="mt-3 grid animate-pulse gap-2">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-3 rounded bg-line" />)}
              </div>
            ) : summary.source === "error" ? (
              <p className="mt-3 text-sm text-muted">{summary.note}</p>
            ) : (
              <>
                <h3 className="mt-3 text-sm font-semibold text-ink">Key reasons</h3>
                <ul className="mt-2 grid list-disc gap-2 pl-5 text-sm leading-relaxed">
                  {summary.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <h3 className="mt-4 text-sm font-semibold text-ink">What&apos;s at stake</h3>
                <p className="mt-1 text-sm leading-relaxed">{summary.stake}</p>
                <p className="mt-3 text-xs text-muted">
                  {summary.source === "ai" ? "Written by AI (Gemini). Every number is checked against the dashboard." : `Template summary (${summary.note}).`} Covers all data, not filters.
                </p>
              </>
            )}
          </section>
          <section className={card} aria-labelledby="stake-h">
            <h2 id="stake-h" className="text-lg font-semibold text-navy">What&apos;s at stake</h2>
            <p className="mt-3 text-3xl font-semibold">{money(d.stakes.recoverableMrrPerMonth)}<span className="text-base font-normal text-muted"> / month</span></p>
            <p className="text-sm text-muted">of retryable revenue your current process doesn&apos;t recover.</p>
            <p className="mt-4 text-sm">
              {d.stakes.minDetectableUplift == null
                ? `A ${d.stakes.trialWeeks}-week trial doesn't have enough failures to detect an uplift.`
                : `A ${d.stakes.trialWeeks}-week trial (~${d.stakes.nPerArm} invoices per group) can detect an uplift of ${(d.stakes.minDetectableUplift * 100).toFixed(1)} pp or more at 80% power.`}
            </p>
            <p className="mt-2 text-xs text-muted">Baseline recovery rate {pct(d.stakes.baselineRate)}, {d.stakes.eligiblePerWeek} retryable failures per week.</p>
          </section>
        </aside>
      </div>

      {selected && (
        <div role="dialog" aria-modal="true" aria-labelledby="inv-h" className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-md overflow-y-auto bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 id="inv-h" className="text-xl font-semibold text-navy">{selected.invoiceId}</h2>
              <button autoFocus onClick={() => setSelected(null)} aria-label="Close" className="rounded-full px-3 py-1 text-lg">✕</button>
            </div>
            <p className="text-sm text-muted">
              {selected.customerId} · {selected.planId} · {money(selected.amount, 2)} · billed {selected.billingDate}
            </p>
            <p className="mt-2 text-sm">{selected.cardBrand} •••• {selected.cardLast4}</p>
            <h3 className="mt-6 font-semibold">Attempt history</h3>
            <ol className="mt-2 grid gap-2">
              {selected.attempts.map((a) => (
                <li key={a.txnId} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex justify-between">
                    <span>{a.attemptNo === 0 ? "Original charge" : `Retry ${a.attemptNo}`} · {a.attemptAt}</span>
                    <span className={a.approved ? "font-semibold text-ok" : "font-semibold text-bad"}>{a.approved ? "Approved" : "Declined"}</span>
                  </div>
                  <p className="text-xs text-muted">{a.code} · {a.text} · Braintree {a.txnId}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
