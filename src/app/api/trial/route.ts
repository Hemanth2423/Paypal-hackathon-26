import { buildInvoices, computeDiagnostic, loadCache } from "@/lib/diagnostic";
import { randomUUID } from "node:crypto";
import { applyConfig, deleteTrial, loadTrial, newTrial, preview, saveTrial, type Trial } from "@/lib/trial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let previewMemo: { key: string; preview: unknown } | null = null;

function respond(trial: Trial) {
  const cache = loadCache();
  if (!cache) return Response.json({ empty: true });
  const asOf = cache.summary.historyEnd ?? cache.summary.syncedAt.slice(0, 10);
  const invoices = buildInvoices(cache.transactions, asOf);
  const key = JSON.stringify([cache.summary.syncedAt, trial.seed, trial.splitB, trial.lengthDays, trial.recoveryWindowDays, trial.assumptions, trial.policy]);
  if (previewMemo?.key === key) return Response.json({ trial, preview: previewMemo.preview });
  const perWeek = computeDiagnostic(invoices, {}, asOf).stakes.eligiblePerWeek;
  const customerIds = cache.customerIds ?? [...new Set(invoices.map((i) => i.customerId))];
  const p = preview(trial, customerIds, invoices, perWeek);
  previewMemo = { key, preview: p };
  return Response.json({ trial, preview: p });
}

// Current trial, or a fresh unsaved draft.
export async function GET() {
  return respond(loadTrial() ?? newTrial());
}

// Updates the draft's settings and readiness. A running trial can't be changed.
export async function POST(req: Request) {
  const current = loadTrial() ?? newTrial();
  if (current.status !== "draft") return Response.json({ error: "This trial is already running and can't be edited." }, { status: 409 });
  const body = (await req.json()) as Partial<Trial> & { reshuffle?: boolean };
  const next = applyConfig(current, body);
  if (body.reshuffle) next.seed = randomUUID().slice(0, 12); // new random assignment
  saveTrial(next);
  return respond(next);
}

// Discards the trial (draft or running), so a new one can be set up.
export async function DELETE() {
  deleteTrial();
  return Response.json({ ok: true });
}
