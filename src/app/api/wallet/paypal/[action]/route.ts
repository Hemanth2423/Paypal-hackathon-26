import { appendLive, captureOrder, chargeSavedWallet, createOrder, createSetupToken, exchangeSetupToken, findSavedWallet, idToken, loadLive, paypalConfigured } from "@/lib/wallet/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AMOUNT = "29.00"; // the Starter plan renewal

// Live PayPal sandbox flow: order (with save-wallet), capture, and a renewal charged to the saved wallet.
export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  if (!paypalConfigured()) return Response.json({ error: "PayPal isn't configured: add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env." }, { status: 503 });
  const { action } = await ctx.params;
  try {
    if (action === "id-token") return Response.json({ idToken: await idToken() });
    if (action === "setup") return Response.json(await createSetupToken());
    if (action === "exchange") {
      const e = await exchangeSetupToken();
      appendLive(e);
      return Response.json(e);
    }
    if (action === "order") return Response.json({ id: await createOrder(AMOUNT) });
    if (action === "capture") {
      const { orderId } = (await req.json()) as { orderId?: string };
      if (!orderId) return Response.json({ error: "Missing orderId." }, { status: 400 });
      const e = await captureOrder(orderId);
      appendLive(e);
      return Response.json(e);
    }
    if (action === "renewal") {
      const payments = [...loadLive()].reverse().filter((e) => e.kind === "payment" || e.kind === "saved");
      let vaultId = payments.find((e) => e.vaultId)?.vaultId ?? null;
      // Saving may have finished after the payment: look it up by the PayPal customer ID.
      const customerId = payments.find((e) => e.customerId)?.customerId;
      if (!vaultId && customerId) vaultId = await findSavedWallet(customerId, 2);
      if (!vaultId) return Response.json({ error: "No saved wallet yet. Pay with PayPal first; if you did, PayPal didn't save the wallet (see the payment's save status)." }, { status: 400 });
      const e = await chargeSavedWallet(vaultId, AMOUNT);
      appendLive(e);
      return Response.json(e);
    }
    return Response.json({ error: "Unknown action." }, { status: 404 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
