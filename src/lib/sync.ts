// Reads the demo merchant's history back from the Braintree sandbox (customer + transaction search).
// The result is cached in .data/sync-cache.json so later screens load fast; it is a copy of API data,
// stamped with when it was synced, and "Connect" always refreshes it from Braintree.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type braintree from "braintree";
import { getGateway, toConnectError, verifyCredentials } from "./braintree";
import { ID_PREFIX } from "./generator";
import { runPool, withRetry } from "./pool";

const CACHE_FILE = ".data/sync-cache.json";
const PAGE = 50;

export type SyncedTransaction = {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  processorResponseCode: string;
  processorResponseText: string;
  merchantAccountId: string;
  customerId: string | null;
  cardBrand: string | null;
  cardDebit: string | null;
  cardLast4: string | null;
  refunded: boolean;
  createdAt: string;
  custom: Record<string, string>;
};

export type SyncSummary = {
  syncedAt: string;
  merchantId: string;
  customers: number;
  transactions: number;
  failedInvoices: number;
  historyStart: string | null; // simulated billing dates
  historyEnd: string | null;
};

export type SyncCache = { summary: SyncSummary; transactions: SyncedTransaction[] };

export type SyncEvent =
  | { stage: "credentials" }
  | { stage: "customers"; count: number }
  | { stage: "transactions"; loaded: number; total: number }
  | { stage: "done"; summary: SyncSummary }
  | { stage: "empty" }
  | { stage: "error"; title: string; fix: string };

type IdsCallback = (err: unknown, res: { ids: string[] }) => void;
// The SDK's callback form of search returns just the matching IDs (its typings only cover the stream form).
type CallbackSearch = (fn: (s: any) => void, cb: IdsCallback) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

function searchIds(search: CallbackSearch, fn: (s: any) => void): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => search(fn, (err, res) => (err ? reject(err) : resolve(res.ids ?? []))));
}

function streamAll<T>(stream: NodeJS.ReadableStream): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    stream.on("data", (x: T) => out.push(x));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);
  });
}

function normalize(t: braintree.Transaction): SyncedTransaction {
  const cc = t.creditCard as (braintree.CreditCard & { debit?: string }) | undefined;
  return {
    id: t.id,
    orderId: t.orderId ?? "",
    status: t.status,
    amount: t.amount,
    currency: t.currencyIsoCode,
    processorResponseCode: t.processorResponseCode,
    processorResponseText: t.processorResponseText,
    merchantAccountId: t.merchantAccountId ?? "",
    customerId: t.customer?.id ?? null,
    cardBrand: cc?.cardType ?? null,
    cardDebit: cc?.debit ?? null,
    cardLast4: cc?.last4 ?? null,
    refunded: (t.refundIds?.length ?? 0) > 0,
    createdAt: String(t.createdAt),
    // The SDK camelCases custom field names (sm_invoice_id → smInvoiceId); restore the API names.
    custom: Object.fromEntries(
      Object.entries((t.customFields as Record<string, string>) ?? {}).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]),
    ),
  };
}

export async function syncFromBraintree(emit: (e: SyncEvent) => void): Promise<void> {
  try {
    const gw = getGateway();
    emit({ stage: "credentials" });
    await verifyCredentials(gw);

    const customerIds = await withRetry(() =>
      searchIds(gw.customer.search.bind(gw.customer) as unknown as CallbackSearch, (s) => s.id().startsWith(`${ID_PREFIX}-cust-`)),
    );
    emit({ stage: "customers", count: customerIds.length });

    const txnIds = await withRetry(() =>
      searchIds(gw.transaction.search.bind(gw.transaction) as unknown as CallbackSearch, (s) => s.orderId().startsWith(`${ID_PREFIX}-inv-`)),
    );
    if (customerIds.length === 0 && txnIds.length === 0) {
      emit({ stage: "empty" });
      return;
    }

    const pages: string[][] = [];
    for (let i = 0; i < txnIds.length; i += PAGE) pages.push(txnIds.slice(i, i + PAGE));
    const transactions: SyncedTransaction[] = [];
    let loaded = 0;
    emit({ stage: "transactions", loaded: 0, total: txnIds.length });
    await runPool(pages, 4, async (ids) => {
      const page = await withRetry(() =>
        streamAll<braintree.Transaction>(gw.transaction.search((s) => s.ids().in(ids)) as unknown as NodeJS.ReadableStream),
      );
      // Keep sales only: refunds are separate credit transactions (the sale carries refundIds), and gateway-rejected
      // attempts never reached the bank (e.g. a duplicate check during seeding).
      transactions.push(...page.filter((t) => t.type === "sale" && t.status !== "gateway_rejected").map(normalize));
      loaded += page.length;
      emit({ stage: "transactions", loaded, total: txnIds.length });
    });

    const billingDates = transactions.map((t) => t.custom.sm_billing_date).filter(Boolean).sort();
    const summary: SyncSummary = {
      syncedAt: new Date().toISOString(),
      merchantId: process.env.BRAINTREE_MERCHANT_ID!.trim(),
      customers: customerIds.length,
      transactions: transactions.length,
      failedInvoices: new Set(transactions.map((t) => t.custom.sm_invoice_id).filter(Boolean)).size,
      historyStart: billingDates[0] ?? null,
      historyEnd: billingDates[billingDates.length - 1] ?? null,
    };
    mkdirSync(".data", { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ summary, transactions } satisfies SyncCache));
    emit({ stage: "done", summary });
  } catch (err) {
    const e = toConnectError(err);
    emit({ stage: "error", title: e.title, fix: e.fix });
  }
}

export function readSyncSummary(): SyncSummary | null {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    return (JSON.parse(readFileSync(CACHE_FILE, "utf8")) as SyncCache).summary;
  } catch {
    return null;
  }
}
