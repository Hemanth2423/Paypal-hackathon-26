"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WALLET_INFO, WALLET_READINESS, type WalletAssumptions } from "@/lib/wallet/info";
import type { WalletReport, WalletTrial } from "@/lib/wallet/experiment";
import type { LiveEvent } from "@/lib/wallet/paypal";

type Plan = { eligible: number; control: number; treatment: number; minDetectableUplift: number | null; expectedUplift: number };
type Data = { trial: WalletTrial; plan: Plan; report: WalletReport | null; live: LiveEvent[]; paypalClientId: string | null };
type State = { kind: "loading" } | { kind: "empty" } | { kind: "error"; msg: string } | { kind: "ok"; data: Data };

const card = "rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-sm";
const primary = "rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "rounded-full border-2 border-action px-5 py-2 font-semibold text-action hover:bg-action/5";
const pct = (x: number | null | undefined, dp = 1) => (x == null ? "—" : `${(x * 100).toFixed(dp)}%`);
const pp = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`);
const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

declare global {
  interface Window {
    paypal?: { Buttons: (o: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void> } };
  }
}

function LivePayPal({ clientId, live, onChange }: { clientId: string | null; live: LiveEvent[]; onChange: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = [...live].reverse().find((e) => e.kind === "payment" && e.vaultId);
  const rendered = useRef(false); // draw the PayPal button once; redrawing destroys the first copy

  useEffect(() => {
    if (!clientId || !ref.current || rendered.current) return;
    rendered.current = true;
    const render = () => {
      if (!window.paypal || !ref.current) return;
      window.paypal
        .Buttons({
          style: { layout: "horizontal", label: "pay", tagline: false, height: 45 },
          createOrder: async () => {
            const r = await fetch("/api/wallet/paypal/order", { method: "POST" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error);
            return j.id;
          },
          onApprove: async (d: { orderID: string }) => {
            const r = await fetch("/api/wallet/paypal/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: d.orderID }) });
            const j = await r.json();
            setMsg(
              !r.ok
                ? j.error
                : `Paid $${j.amount} with PayPal (order ${j.orderId}). ` +
                    (j.vaultId ? "Wallet saved for future renewals." : j.vaultStatus === "APPROVED" ? "PayPal is still saving the wallet; try the renewal in a minute." : "PayPal did not save the wallet (no save status returned)."),
            );
            onChange();
          },
          onError: (e: Error) => setMsg(`PayPal error: ${e.message}`),
        })
        .render(ref.current);
    };
    if (window.paypal) return render();
    // Saving a wallet with a purchase needs a fresh ID token on the script tag (PayPal JS SDK v5).
    fetch("/api/wallet/paypal/id-token", { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.idToken) throw new Error(j.error ?? "No ID token");
        const s = document.createElement("script");
        s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
        s.setAttribute("data-user-id-token", j.idToken);
        s.onload = render;
        s.onerror = () => setMsg("Couldn't load PayPal. Check your connection.");
        document.body.appendChild(s);
      })
      .catch((e) => setMsg(`PayPal setup failed: ${(e as Error).message}`));
  }, [clientId, onChange]);

  async function renew() {
    setBusy(true);
    const r = await fetch("/api/wallet/paypal/renewal", { method: "POST" });
    const j = await r.json();
    setMsg(r.ok ? `Next renewal charged to the saved wallet: $${j.amount}, status ${j.status} (order ${j.orderId}).` : j.error);
    setBusy(false);
    onChange();
  }

  return (
    <section className={card} aria-labelledby="live-h">
      <h2 id="live-h" className="text-lg font-semibold text-navy">Live PayPal (real sandbox)</h2>
      <p className="text-sm text-muted">The treatment group&apos;s payment-update page. Pay with a PayPal sandbox buyer account; the wallet is saved, then charged for the next renewal with no customer present.</p>
      <div className="mt-4 rounded-xl border border-line p-4">
        <p className="font-semibold">Your renewal didn&apos;t go through</p>
        <p className="text-sm text-muted">SecondMint Demo Starter · $29.00 due today</p>
        <div className="mt-3 grid gap-2 opacity-60" aria-hidden>
          <div className="rounded-lg border border-line px-3 py-2 text-sm">Card number</div>
          <div className="rounded-full bg-navy py-2 text-center text-sm font-semibold text-white">Update card</div>
        </div>
        <p className="my-3 text-center text-xs text-muted">or</p>
        {clientId ? <div ref={ref} /> : <p className="text-sm text-bad">Add PAYPAL_CLIENT_ID to .env to show the PayPal button.</p>}
      </div>
      <button className={`${secondary} mt-4`} disabled={!saved || busy} onClick={renew} title={saved ? "Charge the saved wallet" : "Pay with PayPal first"}>
        {busy ? "Charging…" : "Charge next renewal to saved wallet"}
      </button>
      {msg && <p className="mt-3 text-sm" role="status">{msg}</p>}
      {live.length > 0 && (
        <ul className="mt-4 grid gap-1 text-xs text-muted">
          {live.map((e) => (
            <li key={e.orderId + e.at}>
              {new Date(e.at).toLocaleTimeString()} · {e.kind === "payment" ? "Payment" : "Next renewal"} · ${e.amount} · {e.status} · order {e.orderId}
              {e.kind === "payment" && ` · wallet ${e.vaultId ? "saved" : (e.vaultStatus ?? "not saved")}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Wallet() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    try {
      const j = await (await fetch("/api/wallet")).json();
      setState(j.empty ? { kind: "empty" } : { kind: "ok", data: j });
    } catch (e) {
      setState({ kind: "error", msg: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function update(patch: Partial<WalletTrial>, delay = 300) {
    if (state.kind !== "ok") return;
    const trial = { ...state.data.trial, ...patch, assumptions: { ...state.data.trial.assumptions, ...patch.assumptions }, readiness: { ...state.data.trial.readiness, ...patch.readiness } };
    setState({ kind: "ok", data: { ...state.data, trial } });
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const j = await (await fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(trial) })).json();
      if (j.error) setErr(j.error);
      else setState({ kind: "ok", data: j });
    }, delay);
  }

  async function run() {
    setErr(null);
    const r = await fetch("/api/wallet/run", { method: "POST" });
    const j = await r.json();
    if (!r.ok) return setErr(j.missing ? `Still needed: ${j.missing.join("; ")}` : j.error);
    load();
  }

  async function discard() {
    if (!confirm("Discard this wallet experiment and set up a new one?")) return;
    await fetch("/api/wallet", { method: "DELETE" });
    load();
  }

  if (state.kind === "loading") return <div className="h-96 animate-pulse rounded-[16px] bg-line" aria-busy="true" aria-label="Loading" />;
  if (state.kind === "empty")
    return (
      <div className={`${card} mx-auto max-w-[480px] text-center`}>
        <h1 className="text-2xl font-light text-navy">Connect your merchant first</h1>
        <Link href="/" className={`${primary} mt-6 inline-block`}>Go to Connect</Link>
      </div>
    );
  if (state.kind === "error")
    return (
      <div className={`${card} mx-auto max-w-[480px]`} role="alert">
        <p className="font-semibold text-bad">Couldn&apos;t load the wallet experiment</p>
        <p className="mt-2 text-sm text-muted">{state.msg}</p>
        <button className={`${primary} mt-4`} onClick={load}>Try again</button>
      </div>
    );

  const { trial: t, plan, report: r, live, paypalClientId } = state.data;
  const draft = t.status === "draft";
  const missing = (Object.keys(WALLET_READINESS) as (keyof typeof WALLET_READINESS)[]).filter((k) => !t.readiness[k]);
  const underpowered = plan.minDetectableUplift == null || plan.expectedUplift < plan.minDetectableUplift;

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-4xl font-light text-navy">Add PayPal wallet</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Control sees today&apos;s payment-update page (card only). Treatment sees the same page plus a PayPal button. We measure recovered invoices ÷ every customer assigned, not just PayPal clickers, then follow each customer to their next renewal.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid min-w-0 content-start gap-6">
          {draft ? (
            <section className={card} aria-labelledby="setup-h">
              <h2 id="setup-h" className="text-lg font-semibold text-navy">Set up</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  Enrollment period
                  <select className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2" value={t.lengthDays} onChange={(e) => update({ lengthDays: +e.target.value }, 0)}>
                    {[14, 21, 30, 42].map((d) => <option key={d} value={d}>{d} days{d === 30 ? " (default)" : ""}</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Split: card only {100 - t.splitB}% · + PayPal {t.splitB}%
                  <input type="range" min={10} max={90} step={5} value={t.splitB} onChange={(e) => update({ splitB: +e.target.value })} className="mt-3 w-full" />
                </label>
              </div>
              <fieldset className="mt-5 grid gap-3 rounded-xl border border-line p-4">
                <legend className="px-1 text-sm font-semibold">Simulation assumptions</legend>
                <p className="text-xs text-muted">Whether simulated customers pay comes from these values. Hover ⓘ for each source. They&apos;re never tuned to force a win.</p>
                {(Object.keys(WALLET_INFO) as (keyof WalletAssumptions)[]).map((k) => (
                  <label key={k} className="grid grid-cols-[1fr_110px] items-center gap-3 text-sm">
                    <span>
                      {WALLET_INFO[k].label}{" "}
                      <span className="cursor-help text-action" title={WALLET_INFO[k].source} aria-label={WALLET_INFO[k].source} tabIndex={0}>ⓘ</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <input type="number" step={1} className="w-20 rounded-lg border border-line bg-card px-2 py-1.5 text-right" value={+(t.assumptions[k] * 100).toFixed(2)} onChange={(e) => update({ assumptions: { ...t.assumptions, [k]: Number(e.target.value) / 100 } })} />
                      <span className="text-muted">{WALLET_INFO[k].unit}</span>
                    </span>
                  </label>
                ))}
                <p className="text-xs text-muted">Fees: card 2.9% + $0.30, PayPal 3.49% + $0.49 (US standard rates). Refunds 2% in both groups.</p>
              </fieldset>
              <div className={`mt-5 rounded-xl p-4 text-sm ${underpowered ? "bg-warn-bg text-warn" : "bg-ok-bg text-ok"}`} aria-live="polite">
                <p className="font-semibold">Before you start: {plan.eligible.toLocaleString()} eligible customers ({plan.control} card only, {plan.treatment} + PayPal)</p>
                <p className="mt-1">
                  This can detect a lift of {pp(plan.minDetectableUplift)} or more. Your assumptions expect {pp(plan.expectedUplift)}.{" "}
                  {underpowered ? "So expect an inconclusive result unless you add customers or time." : "So a clear result is likely."}
                </p>
              </div>
              <fieldset className="mt-5 grid gap-2 text-sm">
                <legend className="mb-1 font-semibold text-navy">Readiness checklist</legend>
                {(Object.keys(WALLET_READINESS) as (keyof typeof WALLET_READINESS)[]).map((k) => (
                  <label key={k} className="flex gap-3">
                    <input type="checkbox" className="mt-0.5 size-4" checked={t.readiness[k]} onChange={(e) => update({ readiness: { ...t.readiness, [k]: e.target.checked } }, 0)} />
                    {WALLET_READINESS[k]}
                  </label>
                ))}
              </fieldset>
              {(err || missing.length > 0) && <p className="mt-3 text-xs text-muted" role="status">{err ?? `Still needed: ${missing.map((k) => WALLET_READINESS[k]).join("; ")}`}</p>}
              <span title={missing.length ? "Complete the readiness checklist first" : "Run the experiment"}>
                <button className={`${primary} mt-4`} disabled={missing.length > 0} onClick={run}>Run experiment</button>
              </span>
            </section>
          ) : r ? (
            <section id="results" className="grid gap-6 scroll-mt-24">
              <div className={card}>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted">Verdict</p>
                <h2 className="mt-1 text-3xl font-light text-navy">{r.verdict.label}</h2>
                <p className="mt-2 text-sm">
                  Adding PayPal changed recovered invoices per assigned customer by <strong>{pp(r.uplift)}</strong> (95% interval {pp(r.ci95?.low)} to {pp(r.ci95?.high)}, p = {r.pValue?.toFixed(3) ?? "—"}). {r.verdict.reason}
                </p>
                <p className="mt-2 text-xs text-muted">Simulated from your assumptions on sandbox customers. In production, real customers decide.</p>
              </div>
              <div className={card}>
                <h3 className="font-semibold text-navy">Side by side</h3>
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-muted"><th className="font-normal">Metric</th><th>Card only</th><th>+ PayPal</th></tr></thead>
                  <tbody>
                    {[
                      ["Customers assigned", r.groups.control.assigned, r.groups.treatment.assigned],
                      ["Recovered invoices", r.groups.control.recovered, r.groups.treatment.recovered],
                      ["Recovered ÷ assigned (primary)", pct(r.groups.control.recoveryRate), pct(r.groups.treatment.recoveryRate)],
                      ["Paid with PayPal", r.groups.control.paidWithPayPal, r.groups.treatment.paidWithPayPal],
                      ["Processing fees", money(r.groups.control.fees), money(r.groups.treatment.fees)],
                      ["Refunds", r.groups.control.refunds, r.groups.treatment.refunds],
                      ["Net revenue per assigned customer", money(r.groups.control.netPerAssigned), money(r.groups.treatment.netPerAssigned)],
                      ["Next renewal paid ÷ assigned", pct(r.groups.control.nextRenewalPaidRate), pct(r.groups.treatment.nextRenewalPaidRate)],
                      ["Repeat failure among recovered", pct(r.groups.control.repeatFailureRate), pct(r.groups.treatment.repeatFailureRate)],
                    ].map(([l, a, b]) => (
                      <tr key={String(l)} className="border-t border-line"><td className="py-1.5 text-muted">{l}</td><td>{a}</td><td>{b}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-sm">
                  Saved-wallet effect on next renewal: <strong>{pp(r.secondary.uplift)}</strong> (95% interval {pp(r.secondary.ci95?.low)} to {pp(r.secondary.ci95?.high)}). Payment errors: none modeled (equal in both groups).
                </p>
              </div>
              <div className={card}>
                <h3 className="font-semibold text-navy">By why the customer had to act</h3>
                <table className="mt-3 w-full text-sm">
                  <thead><tr className="text-left text-muted"><th className="font-normal">Reason</th><th>Card only</th><th>+ PayPal</th></tr></thead>
                  <tbody>
                    {r.byReason.map((b) => (
                      <tr key={b.reason} className="border-t border-line">
                        <td className="py-1.5">{b.reason === "hard_decline" ? "Hard decline (e.g. expired card)" : "Retries ran out"}</td>
                        <td>{pct(b.control.recoveryRate)} of {b.control.assigned}</td>
                        <td>{pct(b.treatment.recoveryRate)} of {b.treatment.assigned}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">Directional only: small slices are noisy.</p>
              </div>
              <button className={`${secondary} justify-self-start`} onClick={discard}>Discard and set up a new experiment</button>
            </section>
          ) : null}
        </div>
        <aside className="grid content-start gap-6">
          <LivePayPal clientId={paypalClientId} live={live} onChange={load} />
        </aside>
      </div>
    </div>
  );
}
