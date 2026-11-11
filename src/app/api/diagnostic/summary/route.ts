import { leakSummary } from "@/lib/ai";
import { buildInvoices, computeDiagnostic, loadCache } from "@/lib/diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI summary of the top 3 leaks across all data (not filtered). Separate call so the dashboard never waits on AI.
export async function GET() {
  const cache = loadCache();
  if (!cache) return Response.json({ empty: true });
  const asOf = cache.summary.historyEnd ?? cache.summary.syncedAt.slice(0, 10);
  const d = computeDiagnostic(buildInvoices(cache.transactions, asOf), {}, asOf);
  return Response.json(await leakSummary(d, cache.summary.syncedAt));
}
