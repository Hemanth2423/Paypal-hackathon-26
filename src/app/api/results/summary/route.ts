import { reportSummary } from "@/lib/analyst/analyst";
import { loadReport } from "@/lib/results/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The report summary, written by the AI analyst under code checks (template fallback). Separate from the report so
// the Results screen never waits on AI.
export async function GET() {
  const loaded = loadReport();
  if (!loaded.report || loaded.report.kind !== "final") return Response.json({ empty: true });
  return Response.json(await reportSummary(loaded.report, loaded.runId));
}
