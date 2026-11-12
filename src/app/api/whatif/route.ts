import { loadCache } from "@/lib/diagnostic";
import { runWhatIf, type WhatIfInput } from "@/lib/whatif";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simulation only: never writes the trial, its results, or anything in the sandbox.
export async function POST(req: Request) {
  const cache = loadCache();
  if (!cache) return Response.json({ empty: true });
  const input = (await req.json().catch(() => ({}))) as WhatIfInput;
  return Response.json(runWhatIf(cache.customerIds, input));
}
