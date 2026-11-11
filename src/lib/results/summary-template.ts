// The report summary's template (F5/F6). Code always writes the verdict sentence; the AI analyst may replace only the
// supporting sentences, and this template stands in when it can't.

import type { FinalReport } from "./report";

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const pp = (x: number | null | undefined) => (x == null ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)} pp`);

export const verdictSentence = (r: Pick<FinalReport, "verdict">) => `${r.verdict.label}. ${r.verdict.reason}`;

export function templateSupport(r: FinalReport): string[] {
  const { A, B } = r.routes;
  const top = r.byReason[0];
  return [
    `The PayPal route recovered ${pct(B.recoveryRate)} of ${B.eligible} failed invoices and the current route ${pct(A.recoveryRate)} of ${A.eligible}, an uplift of ${pp(r.uplift)} (95% CI ${pp(r.ci95?.low)} to ${pp(r.ci95?.high)}).`,
    ...(top && top.uplift != null ? [`The largest difference was in ${top.label}: ${pct(top.routes.A.recoveryRate)} on the current route against ${pct(top.routes.B.recoveryRate)} on the PayPal route.`] : []),
  ];
}
