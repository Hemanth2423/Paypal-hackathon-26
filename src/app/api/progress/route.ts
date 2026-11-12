import { existsSync } from "node:fs";
import { getRunner } from "@/lib/run/runner";
import { loadTrial } from "@/lib/trial";
import { loadWallet } from "@/lib/wallet/experiment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where the merchant is in the flow, from real state, for the step bar.
export async function GET() {
  const trial = loadTrial();
  const wallet = loadWallet();
  const run = getRunner().state();
  const retryDone = !!trial && run.trialId === trial.id && ["complete", "stopped"].includes(run.status);
  return Response.json({
    connected: existsSync(".data/sync-cache.json"),
    retry: trial ? { status: trial.status, done: retryDone } : null,
    wallet: wallet ? { status: wallet.status, done: wallet.status === "complete" } : null,
  });
}
