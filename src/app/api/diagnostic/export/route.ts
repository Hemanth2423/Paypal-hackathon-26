import { applyFilters, buildInvoices, loadCache, parseFilters, toCsv } from "@/lib/diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exports the current filtered view (global filters + table filter), one row per failed invoice.
export async function GET(req: Request) {
  const cache = loadCache();
  if (!cache) return new Response("No synced data. Connect first.", { status: 404 });
  const asOf = cache.summary.historyEnd ?? cache.summary.syncedAt.slice(0, 10);
  const rows = applyFilters(buildInvoices(cache.transactions, asOf), parseFilters(new URL(req.url).searchParams));
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="secondmint-failed-renewals-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
