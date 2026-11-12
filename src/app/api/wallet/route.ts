import { activeAssumptions } from "@/lib/assumptions";
import { loadCache } from "@/lib/diagnostic";
import { minDetectableUplift } from "@/lib/diagnostic";
import { applyWalletConfig, deleteWallet, eligibleCustomers, loadWallet, newWalletTrial, saveWallet, simulateWallet, walletReport, type WalletTrial } from "@/lib/wallet/experiment";
import { assignRoute } from "@/lib/trial";
import { loadLive } from "@/lib/wallet/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The plan shown before the start and the run use the same start date, so the pre-registered groups are the ones measured.
const startOf = (t: WalletTrial) => t.createdAt.slice(0, 10);

function respond(t: WalletTrial) {
  const cache = loadCache();
  if (!cache) return Response.json({ empty: true });
  const ids = cache.customerIds;
  const eligible = eligibleCustomers(ids, t, startOf(t));
  const treatment = eligible.filter((e) => assignRoute(e.customerId, t.seed, t.splitB) === "B").length;
  const perGroup = Math.min(treatment, eligible.length - treatment);
  const plan = {
    eligible: eligible.length,
    control: eligible.length - treatment,
    treatment,
    minDetectableUplift: minDetectableUplift(t.assumptions.baselineCompletion, perGroup),
    expectedUplift: t.assumptions.baselineCompletion * t.assumptions.relativeLift,
    retryAssumptions: activeAssumptions(),
  };
  const report = t.status === "complete" ? walletReport(simulateWallet(ids, t, startOf(t)), t) : null;
  return Response.json({ trial: t, plan, report, live: loadLive(), paypalClientId: process.env.PAYPAL_CLIENT_ID?.trim() ?? null });
}

// Saves a new draft on first view, so the plan the merchant sees (seed, groups) is the one that runs.
export async function GET() {
  let t = loadWallet();
  if (!t) saveWallet((t = newWalletTrial()));
  return respond(t);
}

export async function POST(req: Request) {
  const t = loadWallet() ?? newWalletTrial();
  if (t.status !== "draft") return Response.json({ error: "This experiment has run and can't be edited. Discard it to start a new one." }, { status: 409 });
  const next = applyWalletConfig(t, (await req.json().catch(() => ({}))) as Partial<WalletTrial>);
  saveWallet(next);
  return respond(next);
}

export async function DELETE() {
  deleteWallet();
  return Response.json({ ok: true });
}
