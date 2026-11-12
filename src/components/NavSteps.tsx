"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Progress = {
  connected: boolean;
  retry: { status: string; done: boolean } | null;
  wallet: { status: string; done: boolean } | null;
};

// The top navigation as a progress bar (F7): ✓ for done, highlight for current, grey and unclickable if not reached.
export default function NavSteps() {
  const path = usePathname();
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => {
    fetch("/api/progress").then((r) => r.json()).then(setP).catch(() => setP(null));
  }, [path]);

  const exp = path.startsWith("/wallet") ? "wallet" : path.startsWith("/trial") || path.startsWith("/results") ? "retry" : p?.wallet && !p?.retry ? "wallet" : "retry";
  const e = exp === "wallet" ? p?.wallet : p?.retry;
  const setupDone = exp === "wallet" ? !!p?.wallet && p.wallet.status !== "draft" : !!p?.retry && p.retry.status === "running";
  const setupHref = exp === "wallet" ? "/wallet" : "/trial";
  const steps = [
    { label: "Connect", href: "/", done: !!p?.connected, reachable: true, current: path === "/" },
    { label: "Diagnose", href: "/diagnostic", done: !!p?.connected && !!(p.retry || p.wallet), reachable: !!p?.connected, current: path === "/diagnostic" },
    { label: "Choose experiment", href: "/diagnostic#measure", done: !!(p?.retry || p?.wallet), reachable: !!p?.connected, current: false },
    { label: "Set up", href: setupHref, done: setupDone, reachable: !!e, current: (path === "/trial" || path === "/wallet") && !setupDone },
    { label: "Run", href: setupHref, done: !!e?.done, reachable: setupDone, current: (path === "/trial" || path === "/wallet") && setupDone && !e?.done },
    { label: "Results", href: exp === "wallet" ? "/wallet#results" : "/results", done: false, reachable: !!e?.done, current: path === "/results" || (path === "/wallet" && !!e?.done) },
  ];

  return (
    <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm" aria-label="Progress">
      {steps.map((s, i) => {
        const badge = (
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-accent text-navy" : s.current ? "bg-white text-navy" : "bg-white/15 text-white/70"}`}>
            {s.done ? "✓" : i + 1}
          </span>
        );
        const body = (
          <>
            {badge}
            <span className="whitespace-nowrap">{s.label}</span>
          </>
        );
        return (
          <li key={s.label} className="flex items-center gap-1">
            {s.reachable ? (
              <Link href={s.href} aria-current={s.current ? "step" : undefined} className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${s.current ? "bg-white/15 font-semibold" : "text-white/90 hover:bg-white/10"}`}>
                {body}
              </Link>
            ) : (
              <span aria-disabled="true" title="Not reached yet" className="flex cursor-not-allowed items-center gap-2 px-3 py-1.5 text-white/45">
                {body}
              </span>
            )}
            {i < steps.length - 1 && <span aria-hidden className={`h-0.5 w-4 rounded ${s.done ? "bg-accent" : "bg-white/25"}`} />}
          </li>
        );
      })}
    </ol>
  );
}
