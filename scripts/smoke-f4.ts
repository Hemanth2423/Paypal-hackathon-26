// F4 sandbox checks.
//   npm run smoke:f4 -- probe   six facts about the sandbox the trial engine depends on (about 40 sales, no seed needed)
//   npm run smoke:f4            a full trial on the Braintree sandbox (needs a completed seed and Connect)
// Probe sales use their own customers (sm-probe-*) and order IDs (sm-probe-*), so they never reach the Diagnostic.

import type braintree from "braintree";
import { describeValidationErrors, getGateway, merchantAccountId } from "../src/lib/braintree";

process.loadEnvFile?.(".env");

const FIELDS = (route: string, n: number) => ({
  sm_invoice_id: `probe-inv-${n}`,
  sm_subscription_id: "probe-sub",
  sm_billing_date: "2026-11-11",
  sm_attempt_at: "2026-11-11",
  sm_attempt_no: String(n),
  sm_invoice_amount: "29.00",
  sm_route: route,
});
const tag = Date.now().toString(36);
type Sale = { success: boolean; transaction?: braintree.Transaction; message?: string };

async function vault(gw: braintree.BraintreeGateway, nonce: string, i: number) {
  const r = await gw.customer.create({ id: `sm-probe-${tag}-${i}`, firstName: "Probe", lastName: String(i), paymentMethodNonce: nonce });
  if (!r.success) throw new Error(`Couldn't vault ${nonce}: ${r.message}`);
  return r.customer.paymentMethods![0].token!;
}

async function sale(gw: braintree.BraintreeGateway, token: string, amount: string, orderId: string, route = "A", n = 0) {
  const t0 = Date.now();
  const r = (await gw.transaction.sale({
    amount,
    paymentMethodToken: token,
    orderId,
    merchantAccountId: merchantAccountId(),
    customFields: FIELDS(route, n),
    options: { submitForSettlement: true },
  })) as unknown as Sale;
  return { r, ms: Date.now() - t0 };
}

async function findByOrder(gw: braintree.BraintreeGateway, orderId: string): Promise<braintree.Transaction[]> {
  return new Promise((resolve, reject) => {
    const out: braintree.Transaction[] = [];
    const stream = gw.transaction.search((s) => s.orderId().is(orderId)) as unknown as NodeJS.ReadableStream;
    stream.on("data", (t: braintree.Transaction) => out.push(t));
    stream.on("end", () => resolve(out));
    stream.on("error", reject);
  });
}

async function probe() {
  const gw = getGateway();
  const times: number[] = [];
  const say = (ok: boolean | null, label: string, detail: string) => console.log(`${ok == null ? "·" : ok ? "✓" : "✗"} ${label}: ${detail}`);

  // 1. All seven custom fields come back on a sale (the SDK camel-cases the names).
  const visa1 = await vault(gw, "fake-valid-visa-nonce", 1);
  const one = await sale(gw, visa1, "2001.00", `sm-probe-${tag}-fields`, "B", 0);
  times.push(one.ms);
  if (!one.r.transaction) return say(false, "custom fields", describeValidationErrors(one.r as never) || one.r.message || "no transaction");
  const cf = (one.r.transaction.customFields ?? {}) as Record<string, string>;
  const back = Object.keys(cf).map((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  say(back.length === 7 && cf.smRoute === "B", "all seven custom fields come back", `${back.sort().join(", ")} (sm_route=${cf.smRoute})`);
  say(one.r.transaction.processorResponseCode === "2001", "2001.00 declines with 2001", `${one.r.transaction.status} ${one.r.transaction.processorResponseCode}`);

  // 2. Two approved sales of the same amount, two customers vaulted from the same nonce, seconds apart, different order IDs.
  const visa2 = await vault(gw, "fake-valid-visa-nonce", 2);
  const a = await sale(gw, visa1, "29.00", `sm-probe-${tag}-same-a`);
  const b = await sale(gw, visa2, "29.00", `sm-probe-${tag}-same-b`);
  times.push(a.ms, b.ms);
  say(a.r.success && b.r.success, "same card number, same amount, seconds apart, different order IDs", `${a.r.transaction?.status} / ${b.r.transaction?.status}${b.r.transaction?.gatewayRejectionReason ? ` (${b.r.transaction.gatewayRejectionReason})` : ""}`);

  // 2b. The case a fast-forward really produces: the same customer, an approval seconds after a decline, new order ID.
  const visa3 = await vault(gw, "fake-valid-visa-nonce", 3);
  await sale(gw, visa3, "2001.00", `sm-probe-${tag}-retry-a0`);
  const retry = await sale(gw, visa3, "29.00", `sm-probe-${tag}-retry-a1`);
  say(retry.r.success, "same customer: decline then approval seconds apart", `${retry.r.transaction?.status}`);

  // 3. The same order ID again after an approval: rejected as a duplicate?
  const dup = await sale(gw, visa1, "29.00", `sm-probe-${tag}-same-a`);
  say(dup.r.transaction?.status === "gateway_rejected", "repeat order ID after an approval", `${dup.r.transaction?.status ?? "no transaction"} ${dup.r.transaction?.gatewayRejectionReason ?? dup.r.message ?? ""}`);

  // 4. Find-by-order-ID sees a new sale, and how soon.
  const fresh = `sm-probe-${tag}-find`;
  await sale(gw, visa2, "2046.00", fresh);
  const t0 = Date.now();
  let found = 0;
  while (Date.now() - t0 < 30_000 && !(found = (await findByOrder(gw, fresh)).length)) await new Promise((r) => setTimeout(r, 1000));
  say(found > 0, "search by order ID finds a new sale", found ? `after ${((Date.now() - t0) / 1000).toFixed(1)} s` : "not within 30 s");

  // 5. Which code each card brand returns for each decline test amount.
  const brands = ["visa", "mastercard", "amex", "discover"];
  const codes = ["2000", "2001", "2004", "2015", "2046", "3000"];
  const mismatches: string[] = [];
  for (const [i, brand] of brands.entries()) {
    const token = await vault(gw, `fake-valid-${brand}-nonce`, 10 + i);
    for (const code of codes) {
      const s = await sale(gw, token, `${code}.00`, `sm-probe-${tag}-${brand}-${code}`);
      times.push(s.ms);
      const got = s.r.transaction?.processorResponseCode ?? `none (${s.r.message})`;
      if (got !== code) mismatches.push(`${brand} ${code}→${got}`);
    }
  }
  say(mismatches.length === 0 ? true : null, "decline codes by card brand", mismatches.length ? `remapped: ${mismatches.join(", ")}` : "every brand returns the code its amount asks for");

  // 6. How long one sale takes.
  times.sort((x, y) => x - y);
  const median = times[Math.floor(times.length / 2)];
  say(null, "time per sale", `median ${median} ms, p90 ${times[Math.floor(times.length * 0.9)]} ms over ${times.length} sales`);
  const perRun = 800 / 8;
  console.log(`  → A full run is about 800 sales at 8 in parallel: ~${((perRun * median) / 1000).toFixed(0)} s at the median.`);
}

// A full trial on the sandbox, in a throwaway folder: every ledger record must match a Braintree transaction,
// no invoice may be collected twice, and the run must finish in under 60 seconds.
async function smoke() {
  const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { seedConfig } = await import("../config/seed.config");
  const { customerId } = await import("../src/lib/generator");
  const { newTrial } = await import("../src/lib/trial");
  delete process.env.TRIAL_GATEWAY; // the real sandbox
  process.chdir(mkdtempSync(join(tmpdir(), "sm-smoke-")));
  mkdirSync(".data");
  const ids = Array.from({ length: seedConfig.customers }, (_, i) => customerId(i + 1));
  const historyEnd = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  writeFileSync(".data/sync-cache.json", JSON.stringify({ summary: { historyEnd, syncedAt: new Date().toISOString() }, customerIds: ids, transactions: [] }));
  writeFileSync(".data/trial.json", JSON.stringify({ ...newTrial(), id: `trial-smoke${Date.now().toString(36).slice(-4)}`, seed: "sweep-4", status: "running" }));
  const { TrialRunner } = await import("../src/lib/run/runner");
  const { Ledger } = await import("../src/lib/run/ledger");
  const runner = new TrialRunner();
  let prepared = 0;
  runner.subscribe((e) => {
    if (e.type === "state" && e.state.status === "running" && !prepared) prepared = Date.now();
  });
  const t0 = Date.now();
  runner.start();
  await runner.settled();
  const s = runner.state();
  const total = (Date.now() - t0) / 1000;
  const engine = prepared ? (Date.now() - prepared) / 1000 : total;
  if (s.status !== "complete") {
    console.error(`✗ run ended ${s.status}: ${s.error?.title ?? ""} ${s.error?.fix ?? s.stop?.reason ?? ""}`);
    process.exit(1);
  }
  const ledger = new Ledger(runner.ledgerFile());
  const gw = getGateway();
  const inBraintree = new Map<string, braintree.Transaction>();
  await new Promise<void>((resolve, reject) => {
    const st = gw.transaction.search((q) => q.orderId().startsWith(`sm-trial-${s.runId}-`)) as unknown as NodeJS.ReadableStream;
    st.on("data", (t: braintree.Transaction) => inBraintree.set(t.id, t));
    st.on("end", resolve);
    st.on("error", reject);
  });
  const mismatched = ledger.records.filter((r) => {
    const t = inBraintree.get(r.id);
    const cf = (t?.customFields ?? {}) as Record<string, string>;
    return !t || t.amount !== r.amount || t.processorResponseCode !== r.processorResponseCode || cf.smInvoiceId !== r.custom.sm_invoice_id || cf.smRoute !== r.route;
  });
  const ok = (b: boolean) => (b ? "✓" : "✗");
  console.log(`${ok(mismatched.length === 0)} ${ledger.records.length} ledger records, ${inBraintree.size} sandbox transactions, ${mismatched.length} mismatched`);
  console.log(`${ok(s.audit?.gatewayDuplicates === 0)} duplicate collections in Braintree: ${s.audit?.gatewayDuplicates}`);
  console.log(`${ok(engine < 60)} fast-forward: ${engine.toFixed(1)} s for ${s.totalDays} simulated days (${total.toFixed(1)} s including loading ${seedConfig.customers} customers)`);
  process.exit(mismatched.length === 0 && s.audit?.gatewayDuplicates === 0 && engine < 60 ? 0 : 1);
}

async function main() {
  if (process.argv[2] === "probe") return probe();
  return smoke();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
