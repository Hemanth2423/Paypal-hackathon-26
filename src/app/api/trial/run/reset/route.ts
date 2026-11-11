import { getRunner } from "@/lib/run/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Forgets the run so the trial can run again under a new run ID.
export async function POST() {
  const runner = getRunner();
  await runner.reset();
  return Response.json({ state: runner.state() });
}
