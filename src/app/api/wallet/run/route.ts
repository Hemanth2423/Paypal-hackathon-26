import { loadWallet, missingReadiness, saveWallet } from "@/lib/wallet/experiment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Runs the wallet experiment once its readiness checklist is complete (enforced here, not just in the UI).
export async function POST() {
  const t = loadWallet();
  if (!t) return Response.json({ error: "Set up the experiment first." }, { status: 404 });
  if (t.status !== "draft") return Response.json({ error: "This experiment has already run." }, { status: 409 });
  const missing = missingReadiness(t);
  if (missing.length) return Response.json({ error: "Readiness checklist incomplete.", missing }, { status: 400 });
  saveWallet({ ...t, status: "complete", ranAt: new Date().toISOString() });
  return Response.json({ ok: true });
}
