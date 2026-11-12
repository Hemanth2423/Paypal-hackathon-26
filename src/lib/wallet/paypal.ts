// PayPal REST sandbox for the wallet experiment's live flow (F8). Secret stays on the server.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const LIVE_FILE = ".data/wallet-live.json";
const base = () => process.env.PAYPAL_API_BASE?.trim() || "https://api-m.sandbox.paypal.com";
const appUrl = () => process.env.APP_URL?.trim() || "http://localhost:3000";

export type LiveEvent = {
  at: string;
  kind: "payment" | "renewal" | "saved";
  orderId: string;
  status: string;
  amount: string;
  vaultId?: string | null;
  vaultStatus?: string | null; // VAULTED, APPROVED (saving still in progress), or null (PayPal didn't save)
  customerId?: string | null; // PayPal customer ID, used to look the saved wallet up later
  error?: string;
};

export function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID?.trim() && process.env.PAYPAL_CLIENT_SECRET?.trim());
}

async function token(): Promise<string> {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID!.trim()}:${process.env.PAYPAL_CLIENT_SECRET!.trim()}`).toString("base64");
  const res = await fetch(`${base()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}` }, body: new URLSearchParams({ grant_type: "client_credentials" }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`PayPal sign-in failed (${res.status}). Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`);
  return ((await res.json()) as { access_token: string }).access_token;
}

// Short-lived ID token the PayPal button script needs (data-user-id-token) to save a wallet with a purchase.
export async function idToken(): Promise<string> {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID!.trim()}:${process.env.PAYPAL_CLIENT_SECRET!.trim()}`).toString("base64");
  const res = await fetch(`${base()}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}` }, body: new URLSearchParams({ grant_type: "client_credentials", response_type: "id_token" }), signal: AbortSignal.timeout(20_000) });
  const j = (await res.json()) as { id_token?: string };
  if (!res.ok || !j.id_token) throw new Error(`PayPal didn't return an ID token (${res.status}).`);
  return j.id_token;
}

async function get(path: string) {
  const res = await fetch(`${base()}${path}`, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`PayPal ${res.status}: ${(json.message as string) ?? "request failed"}`);
  return json;
}

// When PayPal reports the wallet as APPROVED (saving still in progress), look it up by customer ID instead of a webhook.
export async function findSavedWallet(customerId: string, tries = 5): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const j = (await get(`/v3/vault/payment-tokens?customer_id=${encodeURIComponent(customerId)}`)) as { payment_tokens?: { id: string; payment_source?: { paypal?: unknown } }[] };
    const t = j.payment_tokens?.find((p) => p.payment_source?.paypal);
    if (t) return t.id;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function call(path: string, body?: unknown) {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", "PayPal-Request-Id": crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`PayPal ${res.status}: ${(json.message as string) ?? (json.name as string) ?? "request failed"}`);
  return json;
}

// The customer's renewal payment, saving the wallet for future renewals once it succeeds.
export async function createOrder(amount: string) {
  const o = await call("/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: amount }, description: "SecondMint demo renewal" }],
    payment_source: {
      paypal: {
        attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } },
        experience_context: { return_url: `${appUrl()}/wallet`, cancel_url: `${appUrl()}/wallet`, shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
      },
    },
  });
  return o.id as string;
}

type Vault = { id?: string; status?: string; customer?: { id?: string } };
type Captured = { id: string; status: string; payment_source?: { paypal?: { attributes?: { vault?: Vault }; attribute?: { vault?: Vault } } }; purchase_units?: { payments?: { captures?: { amount?: { value?: string } }[] } }[] };

export async function captureOrder(orderId: string): Promise<LiveEvent> {
  const c = (await call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`)) as unknown as Captured;
  const v = c.payment_source?.paypal?.attributes?.vault ?? c.payment_source?.paypal?.attribute?.vault; // PayPal's docs show both spellings
  const customerId = v?.customer?.id ?? null;
  let vaultId = v?.id ?? null;
  if (!vaultId && customerId) vaultId = await findSavedWallet(customerId).catch(() => null);
  return {
    at: new Date().toISOString(),
    kind: "payment",
    orderId: c.id,
    status: c.status,
    amount: c.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? "",
    vaultId,
    vaultStatus: vaultId ? "VAULTED" : (v?.status ?? null),
    customerId,
  };
}

// The next renewal, charged to the saved wallet with no customer present.
export async function chargeSavedWallet(vaultId: string, amount: string): Promise<LiveEvent> {
  const o = (await call("/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: amount }, description: "SecondMint demo next renewal (saved wallet)" }],
    payment_source: { paypal: { vault_id: vaultId } },
  })) as unknown as Captured;
  let final = o;
  if (o.status !== "COMPLETED") final = (await call(`/v2/checkout/orders/${encodeURIComponent(o.id)}/capture`)) as unknown as Captured;
  return { at: new Date().toISOString(), kind: "renewal", orderId: final.id, status: final.status, amount, vaultId };
}

const SETUP_FILE = ".data/wallet-setup.json";
const DEBUG_FILE = ".data/wallet-paypal-debug.json";

// Keeps PayPal's raw replies (no secrets) so any failure can be diagnosed from what PayPal actually said.
function debug(step: string, body: unknown) {
  mkdirSync(".data", { recursive: true });
  const prev = existsSync(DEBUG_FILE) ? (JSON.parse(readFileSync(DEBUG_FILE, "utf8")) as unknown[]) : [];
  writeFileSync(DEBUG_FILE, JSON.stringify([...prev.slice(-19), { at: new Date().toISOString(), step, body }], null, 2));
}

async function vaultCall(path: string, body: unknown, method = "POST") {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", "PayPal-Request-Id": crypto.randomUUID() },
    body: method === "GET" ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  debug(`${method} ${path}`, { status: res.status, json });
  if (!res.ok) {
    const details = (json.details as { issue?: string; description?: string }[] | undefined)?.map((d) => `${d.issue}: ${d.description}`).join("; ");
    throw new Error(`PayPal ${res.status}: ${(json.message as string) ?? (json.name as string) ?? "request failed"}${details ? ` (${details})` : ""}`);
  }
  return json;
}

// Step 1: ask PayPal for a setup token and the buyer approval link. Saves no payment.
export async function createSetupToken(): Promise<{ id: string; approveUrl: string }> {
  const j = (await vaultCall("/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        description: "Save your PayPal wallet for future SecondMint renewals",
        permit_multiple_payment_tokens: false,
        usage_pattern: "IMMEDIATE",
        usage_type: "MERCHANT",
        customer_type: "CONSUMER",
        experience_context: { brand_name: "SecondMint Demo", return_url: `${appUrl()}/wallet?vault=return`, cancel_url: `${appUrl()}/wallet?vault=cancel` },
      },
    },
  })) as { id: string; links?: { rel: string; href: string }[] };
  const approveUrl = j.links?.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal returned no approval link for the setup token.");
  // Kept server-side: the exchange uses this ID, never one taken from the return URL.
  writeFileSync(SETUP_FILE, JSON.stringify({ id: j.id, createdAt: new Date().toISOString() }));
  return { id: j.id, approveUrl };
}

// Step 2 (after the buyer approves): exchange the setup token for the reusable payment token, then read it back.
export async function exchangeSetupToken(): Promise<LiveEvent> {
  if (!existsSync(SETUP_FILE)) throw new Error("No pending save request. Click 'Save PayPal wallet' first.");
  const { id } = JSON.parse(readFileSync(SETUP_FILE, "utf8")) as { id: string };
  const t = (await vaultCall("/v3/vault/payment-tokens", { payment_source: { token: { id, type: "SETUP_TOKEN" } } })) as { id: string; customer?: { id?: string } };
  const check = (await vaultCall(`/v3/vault/payment-tokens/${encodeURIComponent(t.id)}`, null, "GET")) as { id?: string };
  rmSync(SETUP_FILE, { force: true });
  return { at: new Date().toISOString(), kind: "saved", orderId: id, status: check.id === t.id ? "VAULTED" : "UNVERIFIED", amount: "0.00", vaultId: t.id, vaultStatus: "VAULTED", customerId: t.customer?.id ?? null };
}

export const loadLive = (): LiveEvent[] => (existsSync(LIVE_FILE) ? (JSON.parse(readFileSync(LIVE_FILE, "utf8")) as LiveEvent[]) : []);
export function appendLive(e: LiveEvent) {
  mkdirSync(".data", { recursive: true });
  writeFileSync(LIVE_FILE, JSON.stringify([...loadLive(), e], null, 2));
}
