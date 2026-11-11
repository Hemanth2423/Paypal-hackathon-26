// The analyst's tools (F6). Each one reads through the same functions the screens use (the results report and the
// Diagnostic), returns display-ready figures so the model copies numbers instead of computing them, and carries the
// link to the matching filtered view. The server builds every link from the tool's arguments.

import { buildInvoices, computeDiagnostic, loadCache } from "../diagnostic";
import { loadReport } from "../results/load";
import type { Comparison, FinalReport } from "../results/report";
import type { ToolSpec } from "./client";

export type ToolResult =
  | { ok: true; figures: Record<string, string>; link: string; rows?: Record<string, string>[]; note?: string }
  | { ok: false; error: string };

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const pp = (x: number | null | undefined) => (x == null ? "n/a" : `${x >= 0 ? "+" : "-"}${Math.abs(x * 100).toFixed(1)} pp`);
const usd = (n: number | null | undefined, dp = 2) =>
  n == null ? "n/a" : `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const qs = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : "";
};

const SCOPE = { type: "string", enum: ["trial", "diagnostic"], description: "trial: the A/B trial results. diagnostic: the merchant's failed-payment history." };
const REASON = { type: "string", description: "Optional decline code to narrow to, e.g. 2001." };

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "get_metrics",
      description: "Headline metrics. Trial: verdict, recovery rate per route, uplift, 95% CI, p-value, net revenue difference. Diagnostic: failed and recoverable revenue, current recovery rate.",
      parameters: { type: "object", properties: { scope: SCOPE, reason: REASON }, required: ["scope"] },
    },
  },
  {
    type: "function",
    function: {
      name: "breakdown",
      description: "The same metrics split by decline reason. Use it to find which reason drove a difference or a leak.",
      parameters: { type: "object", properties: { scope: SCOPE }, required: ["scope"] },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_routes",
      description: "Route A (current process) vs Route B (PayPal) on one trial metric, optionally within one decline reason.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string", enum: ["recovery_rate", "recovered_amount", "net_recovered", "net_per_invoice", "saved_subscriptions", "eligible"] },
          reason: REASON,
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_invoices",
      description: "Failed trial invoices matching filters, with the count and up to 20 examples.",
      parameters: {
        type: "object",
        properties: {
          route: { type: "string", enum: ["A", "B"] },
          reason: REASON,
          status: { type: "string", enum: ["recovered", "unrecovered", "in_window"] },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
    },
  },
];

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function finalTrial(): { report: FinalReport } | { error: ToolResult } {
  const loaded = loadReport();
  if (!loaded.report) return { error: { ok: false, error: "No trial has run yet, so there are no trial results." } };
  if (loaded.report.kind !== "final")
    return { error: { ok: false, error: `The trial is still running (simulated day ${loaded.report.day} of ${loaded.report.totalDays}); results appear when it finishes.` } };
  return { report: loaded.report };
}

function comparisonFigures(c: Comparison): Record<string, string> {
  return {
    "Route A recovery rate": pct(c.routes.A.recoveryRate),
    "Route B recovery rate": pct(c.routes.B.recoveryRate),
    "Uplift": pp(c.uplift),
    "95% CI": `${pp(c.ci95?.low)} to ${pp(c.ci95?.high)}`,
    "p-value": c.pValue == null ? "n/a" : c.pValue < 0.001 ? "below 0.001" : c.pValue.toFixed(3),
    "Route A eligible invoices": String(c.routes.A.eligible),
    "Route B eligible invoices": String(c.routes.B.eligible),
    "Route A recovered invoices": String(c.routes.A.recovered),
    "Route B recovered invoices": String(c.routes.B.recovered),
  };
}

function diagnostic(reason?: string) {
  const cache = loadCache();
  if (!cache) return null;
  const asOf = cache.summary.historyEnd ?? cache.summary.syncedAt.slice(0, 10);
  return computeDiagnostic(buildInvoices(cache.transactions, asOf), { reason }, asOf);
}

const METRIC: Record<string, { label: string; get: (c: Comparison) => [string, string, string] }> = {
  recovery_rate: { label: "Recovery rate", get: (c) => [pct(c.routes.A.recoveryRate), pct(c.routes.B.recoveryRate), pp(c.uplift)] },
  recovered_amount: { label: "Recovered $", get: (c) => [usd(c.routes.A.recoveredAmount), usd(c.routes.B.recoveredAmount), usd(c.routes.B.recoveredAmount - c.routes.A.recoveredAmount)] },
  net_recovered: { label: "Net recovered $", get: (c) => [usd(c.routes.A.net), usd(c.routes.B.net), usd(c.routes.B.net - c.routes.A.net)] },
  net_per_invoice: { label: "Net $ per eligible invoice", get: (c) => [usd(c.routes.A.netPerEligible), usd(c.routes.B.netPerEligible), usd(c.netPerInvoiceDifference)] },
  saved_subscriptions: { label: "Saved subscriptions", get: (c) => [String(c.routes.A.savedSubscriptions), String(c.routes.B.savedSubscriptions), String(c.routes.B.savedSubscriptions - c.routes.A.savedSubscriptions)] },
  eligible: { label: "Eligible failures", get: (c) => [String(c.routes.A.eligible), String(c.routes.B.eligible), String(c.routes.B.eligible - c.routes.A.eligible)] },
};

export function runTool(name: string, args: Args): ToolResult {
  const reason = str(args.reason);
  switch (name) {
    case "get_metrics": {
      if (args.scope === "diagnostic") {
        const d = diagnostic(reason);
        if (!d) return { ok: false, error: "No merchant data is synced yet; connect the sandbox merchant first." };
        return {
          ok: true,
          link: `/diagnostic${qs({ reason })}`,
          figures: {
            "Failed revenue": usd(d.kpis.failedRevenue, 0),
            "Recoverable revenue": usd(d.kpis.recoverableRevenue, 0),
            "Current recovery rate": pct(d.kpis.recoveryRate),
            "Lost to hard declines": usd(d.kpis.hardRevenue, 0),
            "Recoverable MRR per month": usd(d.stakes.recoverableMrrPerMonth, 0),
            "Hard-decline retries": String(d.waste.hardRetries),
          },
        };
      }
      if (args.scope !== "trial") return { ok: false, error: 'scope must be "trial" or "diagnostic".' };
      const t = finalTrial();
      if ("error" in t) return t.error;
      const r = t.report;
      if (reason) {
        const row = r.byReason.find((x) => x.code === reason);
        if (!row) return { ok: false, error: `No eligible trial invoices have decline code ${reason}.` };
        return { ok: true, link: `/results${qs({ reason })}`, figures: { "Decline reason": row.label, ...comparisonFigures(row) } };
      }
      return {
        ok: true,
        link: "/results",
        figures: {
          "Verdict": r.verdict.label,
          ...comparisonFigures(r),
          "Net revenue difference (PayPal route minus current)": usd(r.netDifferenceScaled, 0),
          "Net $ per eligible invoice difference": usd(r.netPerInvoiceDifference),
        },
        note: "Outcomes are simulated by a documented model on sandbox data; they are not real-world PayPal performance.",
      };
    }
    case "breakdown": {
      if (args.scope === "diagnostic") {
        const d = diagnostic();
        if (!d) return { ok: false, error: "No merchant data is synced yet; connect the sandbox merchant first." };
        return {
          ok: true,
          link: "/diagnostic",
          figures: {},
          rows: d.reasons.map((x) => ({ "Decline reason": `${x.code} ${x.name}`, "Failed revenue": usd(x.amount, 0), "Share of failed revenue": pct(x.share), "Recovery rate": pct(x.recoveryRate), "Type": x.type })),
        };
      }
      if (args.scope !== "trial") return { ok: false, error: 'scope must be "trial" or "diagnostic".' };
      const t = finalTrial();
      if ("error" in t) return t.error;
      return {
        ok: true,
        link: "/results",
        figures: {},
        rows: t.report.byReason.map((x) => ({ "Decline reason": x.label, "Route A recovery rate": pct(x.routes.A.recoveryRate), "Route B recovery rate": pct(x.routes.B.recoveryRate), "Uplift": pp(x.uplift), "Invoices A / B": `${x.routes.A.eligible} / ${x.routes.B.eligible}` })),
      };
    }
    case "compare_routes": {
      const m = METRIC[String(args.metric)];
      if (!m) return { ok: false, error: `Unknown metric. Use one of: ${Object.keys(METRIC).join(", ")}.` };
      const t = finalTrial();
      if ("error" in t) return t.error;
      const c = reason ? t.report.byReason.find((x) => x.code === reason) : t.report;
      if (!c) return { ok: false, error: `No eligible trial invoices have decline code ${reason}.` };
      const [a, b, diff] = m.get(c);
      return { ok: true, link: `/results${qs({ reason })}`, figures: { [`Route A ${m.label}`]: a, [`Route B ${m.label}`]: b, [`${m.label} difference (B minus A)`]: diff } };
    }
    case "list_invoices": {
      const loaded = loadReport();
      if (!loaded.report) return { ok: false, error: "No trial has run yet, so there are no trial invoices." };
      const route = str(args.route);
      const status = str(args.status);
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
      const rows = loaded.report.invoices.filter((i) => (!route || i.route === route) && (!reason || i.firstCode === reason) && (!status || i.status === status));
      return {
        ok: true,
        link: `/results${qs({ route, reason, status })}`,
        figures: { "Matching invoices": String(rows.length) },
        rows: rows.slice(0, limit).map((i) => ({ Invoice: i.invoiceId, Route: i.route ?? "", Decline: `${i.firstCode} ${i.declineName}`, Amount: usd(i.amount), Status: i.status })),
      };
    }
    default:
      return { ok: false, error: `Unknown tool "${name}".` };
  }
}
