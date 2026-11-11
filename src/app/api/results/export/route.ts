import { loadReport } from "@/lib/results/load";
import { reportCsv } from "@/lib/results/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Results CSV in the Diagnostic's schema, for the current filters (route, reason, status). One row per failed invoice.
export async function GET(req: Request) {
  const loaded = loadReport();
  if (!loaded.report) return new Response("No trial has run yet.", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const csv = reportCsv(loaded.report, { route: sp.get("route") || undefined, reason: sp.get("reason") || undefined, status: sp.get("status") || undefined });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="secondmint-trial-results-${loaded.runId}.csv"`,
    },
  });
}
