import { loadReport } from "@/lib/results/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The results report for the current run: progress while it runs, the full report once it finishes.
export async function GET(req?: Request) {
  const loaded = loadReport();
  if (!loaded.report) return Response.json({ empty: true });
  // ?brief=1: just whether the run is finished and its verdict (the analyst panel's suggestions need nothing more).
  if (req && new URL(req.url).searchParams.get("brief")) {
    const r = loaded.report;
    return Response.json({ kind: r.kind, ...(r.kind === "final" ? { verdict: r.verdict } : {}) });
  }
  return Response.json({ runId: loaded.runId, ...loaded.report });
}
