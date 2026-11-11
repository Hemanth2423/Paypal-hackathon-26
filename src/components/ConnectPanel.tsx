"use client";

import { useState } from "react";
import type { SyncEvent, SyncSummary } from "@/lib/sync";

type View =
  | { kind: "idle" }
  | { kind: "loading"; step: string; loaded?: number; total?: number; customers?: number }
  | { kind: "empty" }
  | { kind: "error"; title: string; fix: string }
  | { kind: "done"; summary: SyncSummary };

const card = "rounded-[var(--radius-card)] border border-line bg-card p-8 shadow-sm";
const primaryBtn =
  "w-full rounded-full bg-navy px-6 py-3.5 text-base font-semibold text-white hover:bg-navy-deep disabled:opacity-60";
const secondaryBtn =
  "w-full rounded-full border-2 border-action px-6 py-3 text-base font-semibold text-action hover:bg-action/5";

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";

export default function ConnectPanel({ initialSummary }: { initialSummary: SyncSummary | null }) {
  const [view, setView] = useState<View>(initialSummary ? { kind: "done", summary: initialSummary } : { kind: "idle" });

  async function connect() {
    setView({ kind: "loading", step: "Checking credentials…" });
    try {
      const res = await fetch("/api/connect", { method: "POST" });
      if (!res.body) throw new Error("No response from the server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let customers: number | undefined;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const e = JSON.parse(line) as SyncEvent;
          if (e.stage === "credentials") setView({ kind: "loading", step: "Checking credentials…" });
          if (e.stage === "customers") {
            customers = e.count;
            setView({ kind: "loading", step: "Finding transactions…", customers });
          }
          if (e.stage === "transactions")
            setView({ kind: "loading", step: "Loading transactions", loaded: e.loaded, total: e.total, customers });
          if (e.stage === "empty") setView({ kind: "empty" });
          if (e.stage === "error") setView({ kind: "error", title: e.title, fix: e.fix });
          if (e.stage === "done") setView({ kind: "done", summary: e.summary });
        }
      }
    } catch (err) {
      setView({ kind: "error", title: "Something went wrong while connecting", fix: (err as Error).message });
    }
  }

  if (view.kind === "idle")
    return (
      <div className={card}>
        <div className="flex items-start gap-4">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-page text-2xl">
            🔌
          </span>
          <div>
            <h2 className="text-lg font-semibold text-navy">Braintree sandbox</h2>
            <p className="mt-1 text-sm text-muted">
              Uses the API keys in <code>.env</code>. We only read customers and transactions.
            </p>
          </div>
        </div>
        <button className={`${primaryBtn} mt-8`} onClick={connect}>
          Connect sandbox merchant
        </button>
      </div>
    );

  if (view.kind === "loading") {
    const pct = view.total ? Math.round(((view.loaded ?? 0) / view.total) * 100) : null;
    return (
      <div className={card} aria-busy="true">
        <p className="font-semibold text-navy" aria-live="polite">
          {view.step}
          {view.total != null && ` ${(view.loaded ?? 0).toLocaleString()} of ${view.total.toLocaleString()}`}
        </p>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
        >
          <div
            className={`h-full rounded-full bg-action transition-all ${pct == null ? "w-1/3 animate-pulse" : ""}`}
            style={pct != null ? { width: `${pct}%` } : undefined}
          />
        </div>
        {view.customers != null && (
          <p className="mt-4 text-sm text-muted">{view.customers.toLocaleString()} customers found</p>
        )}
      </div>
    );
  }

  if (view.kind === "empty")
    return (
      <div className={card}>
        <h2 className="text-lg font-semibold text-navy">Connected, but there's no demo data yet</h2>
        <p className="mt-2 text-sm text-muted">
          Your credentials work. Create the demo merchant in this sandbox by running <code>npm run seed</code> in the
          project folder (takes about 10 minutes), then connect again.
        </p>
        <button className={`${secondaryBtn} mt-6`} onClick={connect}>
          Connect again
        </button>
      </div>
    );

  if (view.kind === "error")
    return (
      <div className={`${card} border-bad/40`} role="alert">
        <p className="text-sm font-semibold text-bad">Couldn't connect</p>
        <h2 className="mt-1 text-lg font-semibold text-ink">{view.title}</h2>
        <p className="mt-2 text-sm text-muted">{view.fix}</p>
        <button className={`${primaryBtn} mt-6`} onClick={connect}>
          Try again
        </button>
      </div>
    );

  const s = view.summary;
  const stats = [
    { label: "Customers", value: s.customers.toLocaleString() },
    { label: "Transactions", value: s.transactions.toLocaleString() },
    { label: "Failed renewals", value: s.failedInvoices.toLocaleString() },
    { label: "Billing history", value: `${fmtDate(s.historyStart)} – ${fmtDate(s.historyEnd)}` },
  ];
  return (
    <div className={card}>
      <p className="inline-flex items-center gap-2 rounded-full bg-ok-bg px-3 py-1 text-sm font-semibold text-ok">
        <span aria-hidden>✓</span> Connected
      </p>
      <h2 className="mt-4 text-lg font-semibold text-navy">Merchant {s.merchantId}</h2>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5">
        {stats.map((x) => (
          <div key={x.label} className={x.label === "Billing history" ? "col-span-2" : ""}>
            <dt className="text-sm text-muted">{x.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink">{x.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-xs text-muted">
        Synced from Braintree sandbox {new Date(s.syncedAt).toLocaleString()}. Billing dates are simulated.
      </p>
      <button className={`${secondaryBtn} mt-6`} onClick={connect}>
        Sync again
      </button>
    </div>
  );
}
