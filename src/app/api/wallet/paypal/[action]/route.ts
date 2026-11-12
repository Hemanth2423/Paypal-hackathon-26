import { appendLive, captureOrder, chargeSavedWallet, createOrder, loadLive, paypalConfigured } from "@/lib/wallet/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AMOUNT = "29.00"; // the Starter plan renewal

// Live PayPal sandbox flow: order (with save-wallet), capture, and a renewal charged to the saved wallet.
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  if (!paypalConfigured()) return Response.json({ error: "PayPal isn't configured: add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env." }, { status: 503 });
  const { action } = await ctx.params;
  try {
    if (action === "order") return Response.json({ id: await createOrder(AMOUNT) });
    if (action === "capture") {
      const { orderId } = (await req.json()) as { orderId?: string };
      if (!orderId) return Response.json({ error: "Missing orderId." }, { status: 400 });
      const e = await captureOrder(orderId);
      appendLive(e);
      return Response.json(e);
    }
    if (action === "renewal") {
      const vaultId = [...loadLive()].reverse().find((e) => e.kind === "payment" && e.vaultId)?.vaultId;
      if (!vaultId) return Response.json({ error: "No saved wallet yet. Pay with PayPal first." }, { status: 400 });
      const e = await chargeSavedWallet(vaultId, AMOUNT);
      appendLive(e);
      return Response.json(e);
    }
    return Response.json({ error: "Unknown action." }, { status: 404 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
