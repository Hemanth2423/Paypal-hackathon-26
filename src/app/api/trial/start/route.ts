import { loadTrial, saveTrial, uncheckedReadiness } from "@/lib/trial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts the trial only when every readiness item is checked (enforced here, not just in the UI).
export async function POST() {
  const t = loadTrial();
  if (!t) return Response.json({ error: "Set up the trial first." }, { status: 404 });
  if (t.status !== "draft") return Response.json({ error: "This trial is already running." }, { status: 409 });
  const missing = uncheckedReadiness(t);
  if (missing.length) return Response.json({ error: "Readiness checklist incomplete.", missing }, { status: 400 });
  const running = { ...t, status: "running" as const, startedAt: new Date().toISOString() };
  saveTrial(running);
  return Response.json({ trial: running });
}
