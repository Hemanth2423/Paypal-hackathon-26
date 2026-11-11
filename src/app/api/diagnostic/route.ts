import { buildInvoices, computeDiagnostic, loadCache, parseFilters } from "@/lib/diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cache = loadCache();
  if (!cache) return Response.json({ empty: true });
  const asOf = cache.summary.historyEnd ?? cache.summary.syncedAt.slice(0, 10);
  const f = parseFilters(new URL(req.url).searchParams);
  const invoices = buildInvoices(cache.transactions, asOf);
  const d = computeDiagnostic(invoices, { from: f.from, to: f.to, reason: f.reason, brand: f.brand, plan: f.plan }, asOf);
  const options = {
    reasons: [...new Map(invoices.map((i) => [i.firstCode, i.declineName])).entries()].sort(),
    brands: [...new Set(invoices.map((i) => i.cardBrand))].sort(),
    plans: [...new Set(invoices.map((i) => i.planId))].sort(),
    minDate: cache.summary.historyStart,
    maxDate: cache.summary.historyEnd,
  };
  return Response.json({ ...d, options, syncedAt: cache.summary.syncedAt });
}
