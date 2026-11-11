"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Answer } from "@/lib/analyst/analyst";

type Suggestion = { q: string; href: string };
type Turn = { q: string; a: Answer | null; failed?: boolean };
type TrialState = "none" | "running" | "paypal_wins" | "current_wins" | "inconclusive";

function suggestions(path: string, trial: TrialState): Suggestion[] {
  const diagnostic: Suggestion[] = [
    { q: "Where am I losing the most money?", href: "/diagnostic" },
    { q: "How much recoverable revenue do I miss each month?", href: "/diagnostic?type=soft" },
    { q: "Which decline reason has the lowest recovery rate?", href: "/diagnostic" },
  ];
  if (trial === "none" || trial === "running") return path.startsWith("/diagnostic") || path === "/" ? diagnostic : [{ q: "Has the trial finished yet?", href: "/trial" }, ...diagnostic.slice(0, 2)];
  const trialQs: Suggestion[] = [
    { q: "Which decline reason drove the uplift?", href: "/results" },
    { q: "How much more net revenue did the PayPal route recover?", href: "/results" },
    trial === "inconclusive"
      ? { q: "Why is the result inconclusive?", href: "/results" }
      : { q: "How many invoices did each route recover?", href: "/results?status=recovered" },
  ];
  return path.startsWith("/diagnostic") ? [...diagnostic.slice(0, 1), ...trialQs.slice(0, 2)] : trialQs;
}

export default function AnalystPanel() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [trial, setTrial] = useState<TrialState>("none");
  const pill = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = turns.some((t) => !t.a && !t.failed);
  const last = turns[turns.length - 1]?.a;
  const aiDown = last?.status === "off" || last?.status === "limited";

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    fetch("/api/results?brief=1")
      .then((r) => r.json())
      .then((d) => setTrial(d.empty ? "none" : d.kind === "final" ? d.verdict.verdict : "running"))
      .catch(() => setTrial("none"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    pill.current?.focus();
  }

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setDraft("");
    setTurns((t) => [...t, { q: question, a: null }]);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const a = (await res.json()) as Answer & { error?: string };
      if (!res.ok) throw new Error(a.error);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, failed: true } : x)));
    }
  }

  const sugg = suggestions(path, trial);

  return (
    <div data-analyst className="print:hidden">
      <button
        ref={pill}
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="analyst-panel"
        className="fixed bottom-6 right-6 z-40 rounded-full bg-navy px-5 py-3 font-semibold text-white shadow-lg hover:bg-navy-deep"
      >
        Ask the analyst
      </button>
      {open && (
        <aside
          id="analyst-panel"
          role="dialog"
          aria-label="AI analyst"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[400px] flex-col border-l border-line bg-card shadow-2xl"
        >
          <header className="flex items-start justify-between gap-3 border-b border-line bg-navy px-5 py-4 text-white">
            <div>
              <h2 className="text-lg font-semibold">AI analyst</h2>
              <p className="text-xs text-white/80">Answers only from your sandbox data. Trial outcomes are simulated.</p>
            </div>
            <button onClick={close} className="rounded-full px-3 py-1 text-sm font-semibold hover:bg-white/10" aria-label="Close the analyst">
              Close
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite">
            {turns.length === 0 && (
              <div className="grid gap-3">
                <p className="text-sm text-muted">Ask about your failed payments or the trial. Try:</p>
                {sugg.map((s) => (
                  <button key={s.q} onClick={() => ask(s.q)} className="rounded-xl border border-line bg-page px-4 py-3 text-left text-sm font-medium text-ink hover:border-action">
                    {s.q}
                  </button>
                ))}
              </div>
            )}
            <ol className="grid gap-5">
              {turns.map((t, i) => (
                <li key={i} className="grid gap-2">
                  <p className="justify-self-end rounded-2xl bg-navy px-4 py-2 text-sm text-white">{t.q}</p>
                  {!t.a && !t.failed && (
                    <p className="text-sm text-muted" role="status">
                      Reading your data…
                    </p>
                  )}
                  {t.failed && (
                    <div className="rounded-xl bg-bad-bg p-3 text-sm text-bad" role="alert">
                      The analyst didn&apos;t respond.{" "}
                      <button className="font-semibold underline" onClick={() => (setTurns((x) => x.slice(0, -1)), ask(t.q))}>
                        Try again
                      </button>
                    </div>
                  )}
                  {t.a && (
                    <div className={`rounded-2xl px-4 py-3 text-sm ${t.a.status === "answered" ? "bg-page text-ink" : "bg-warn-bg text-warn"}`}>
                      <p>{t.a.text}</p>
                      {t.a.citations.length > 0 && (
                        <ul className="mt-2 grid gap-0.5 text-xs text-muted">
                          {t.a.citations.map((c) => (
                            <li key={c.metric}>
                              {c.metric}: <span className="font-semibold text-ink">{c.value}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {t.a.links.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {t.a.links.map((href) => (
                            <Link key={href} href={href} onClick={() => setOpen(false)} className="text-xs font-semibold text-action-dark underline-offset-2 hover:underline">
                              Open this view →
                            </Link>
                          ))}
                        </div>
                      )}
                      {(t.a.status === "off" || t.a.status === "limited") && i === turns.length - 1 && (
                        <div className="mt-2 grid gap-1 text-xs">
                          <p>Meanwhile, these views answer the usual questions:</p>
                          {sugg.map((s) => (
                            <Link key={s.q} href={s.href} onClick={() => setOpen(false)} className="font-semibold text-action-dark underline">
                              {s.q}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <form
            className="flex gap-2 border-t border-line p-4"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <label htmlFor="analyst-q" className="sr-only">
              Your question
            </label>
            <textarea
              id="analyst-q"
              ref={input}
              rows={2}
              maxLength={500}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              placeholder={aiDown ? "The AI is unavailable right now" : "Ask about your data"}
              className="flex-1 resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="rounded-full bg-navy px-5 font-semibold text-white disabled:opacity-50">
              Ask
            </button>
          </form>
        </aside>
      )}
    </div>
  );
}
