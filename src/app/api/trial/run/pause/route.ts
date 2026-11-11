import { getRunner } from "@/lib/run/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pauses at the end of the current simulated day.
export async function POST() {
  const runner = getRunner();
  runner.pause();
  return Response.json({ state: runner.state() });
}
