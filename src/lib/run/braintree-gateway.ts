// The Braintree sandbox behind the trial engine (F4). Sends each sale the way the seed script does, plus the route
// tag, and maps the result to the engine's four outcomes. Records use the sync's own shape (normalize).

import type braintree from "braintree";
import { ConnectError, describeValidationErrors, getGateway, merchantAccountId } from "../braintree";
import { runPool, withRetry } from "../pool";
import { normalize, streamAll, type SyncedTransaction } from "../sync";
import { trialCustomers, type TrialCustomer } from "./failures";
import type { SaleRequest, SaleResult, TrialGateway } from "./gateway";

type SaleResponse = { success: boolean; transaction?: braintree.Transaction; message?: string; errors?: unknown };

const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// The SDK's callback form of search returns just the matching IDs (its typings only cover the stream form).
function searchIds(search: unknown, fn: (s: any) => void): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) =>
    (search as (f: typeof fn, cb: (err: unknown, res: { ids: string[] }) => void) => void)(fn, (err, res) => (err ? reject(err) : resolve(res.ids ?? []))),
  );
}


export class BraintreeTrialGateway implements TrialGateway {
  readonly kind = "braintree" as const;
  constructor(readonly gw: braintree.BraintreeGateway = getGateway()) {}

  async sale(req: SaleRequest): Promise<SaleResult> {
    const r = (await this.gw.transaction.sale({
      amount: req.amount,
      paymentMethodToken: req.paymentMethodToken,
      orderId: req.orderId,
      merchantAccountId: req.merchantAccountId ?? merchantAccountId(),
      customFields: req.customFields,
      options: { submitForSettlement: true },
    })) as unknown as SaleResponse;
    const t = r.transaction;
    if (!t) return { outcome: "invalid", transaction: null, message: describeValidationErrors(r as never) || r.message || "Braintree created no transaction." };
    if (t.status === "gateway_rejected") return { outcome: "rejected", transaction: null, message: `Gateway Rejected: ${t.gatewayRejectionReason ?? "unknown"}` };
    return { outcome: r.success ? "collected" : "declined", transaction: normalize(t) };
  }

  // Matching IDs first, then pages of 50 fetched 4 at a time (one page at a time takes ~10 s for a full run).
  async findByOrderPrefix(prefix: string): Promise<SyncedTransaction[]> {
    const ids = await searchIds(this.gw.transaction.search.bind(this.gw.transaction), (s) => s.orderId().startsWith(prefix));
    const found: braintree.Transaction[] = [];
    await runPool(chunks(ids, 50), 4, async (page) => {
      found.push(...(await withRetry(() => streamAll<braintree.Transaction>(this.gw.transaction.search((s) => s.ids().in(page)) as unknown as NodeJS.ReadableStream))));
    });
    return found.filter((t) => t.type === "sale" && t.status !== "gateway_rejected").map(normalize);
  }
}

// Card and plan for the trial customers who will be charged, read from Braintree before day 0 (every start and
// resume). Which renewals fail is known in advance, so only those customers (about a quarter) are loaded.
export async function loadBraintreeCustomers(ids: string[], gateway: TrialGateway, needed: string[] = ids): Promise<TrialCustomer[]> {
  if (!(gateway instanceof BraintreeTrialGateway)) throw new Error("Braintree customers need the Braintree gateway.");
  // The SDK's typings cover only the callback form of customer search; without a callback it returns a stream.
  const search = gateway.gw.customer.search.bind(gateway.gw.customer) as unknown as (fn: (s: { ids(): { in(ids: string[]): void } }) => void) => NodeJS.ReadableStream;
  const found: braintree.Customer[] = [];
  await runPool(chunks(needed, 50), 4, async (page) => {
    found.push(...(await withRetry(() => streamAll<braintree.Customer>(search((s) => s.ids().in(page))))));
  });
  const known = new Map<string, Partial<TrialCustomer>>();
  for (const c of found) {
    const card = (c.creditCards ?? [])[0] as (braintree.CreditCard & { subscriptions?: braintree.Subscription[] }) | undefined;
    const sub = card?.subscriptions?.find((x) => x.status === "Active") ?? card?.subscriptions?.[0];
    if (!card?.token) continue;
    known.set(c.id, { paymentMethodToken: card.token, subscriptionId: sub?.id ?? "", ...(sub ? { price: Number(sub.price) } : {}) });
  }
  const missing = needed.filter((id) => !known.get(id)?.paymentMethodToken);
  if (missing.length)
    throw new ConnectError(
      `${missing.length} trial customer${missing.length > 1 ? "s have" : " has"} no saved card in Braintree (first: ${missing.slice(0, 3).join(", ")})`,
      'Run "npm run seed" again to finish creating customers, then Connect and start the trial.',
    );
  return trialCustomers(ids, known);
}
