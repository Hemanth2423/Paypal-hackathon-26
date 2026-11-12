import { seedConfig } from "@config/seed.config";
import { getRunner } from "@/lib/run/runner";
import { loadTrial } from "@/lib/trial";
import { clampAssumptions } from "@/lib/assumptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The model's assumptions, shown on the run screen so every simulated number can be traced to its input.
const assumptions = {
  routeA: seedConfig.existingProcess,
  routeB: seedConfig.trialModel.routeB,
  paydays: seedConfig.trialModel.paydays,
  insufficientFunds: seedConfig.trialModel.insufficientFunds,
  otherCodes: seedConfig.declineMix.map((d) => ({ code: String(d.code), retrySuccess: d.retrySuccess })),
  renewalFailureRate: seedConfig.renewalFailureRate,
};

// Run state and every finished day so far, so a reopened page can redraw the timeline.
export async function GET() {
  const runner = getRunner();
  const trial = loadTrial();
  const a = clampAssumptions(trial?.assumptions);
  return Response.json({ trial, state: runner.state(), active: runner.isActive(), assumptions: { ...assumptions, renewalFailureRate: a.renewalFailureRate, market: a } });
}

// Starts or resumes the run and streams its events as newline-delimited JSON. Closing the stream leaves the run going.
export async function POST() {
  const runner = getRunner();
  const started = runner.start();
  if (!started.ok) return Response.json({ error: started.error, state: runner.state() }, { status: started.status });
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          unsubscribe(); // the browser went away; the run carries on
        }
      };
      send({ type: "state", state: runner.state() });
      unsubscribe = runner.subscribe(send) as () => void;
      runner.settled().then(() => {
        unsubscribe();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
