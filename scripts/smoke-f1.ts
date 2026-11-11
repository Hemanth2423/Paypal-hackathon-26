// F1 sandbox smoke test (TechSpec §6): seed → sync → what Braintree returns matches the seed plan.
// Usage: npm run smoke:f1   (after npm run seed)

import { existsSync, readFileSync } from "node:fs";
import { seedConfig } from "../config/seed.config";
import { anchorToDate, buildSeedPlan } from "../src/lib/generator";
import { syncFromBraintree, type SyncEvent, type SyncedTransaction } from "../src/lib/sync";

process.loadEnvFile?.(".env");

const PROGRESS_FILE = ".data/seed-progress.json";
const CACHE_FILE = ".data/sync-cache.json";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const anchor = existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")).anchorDate : undefined;
  const plan = buildSeedPlan(seedConfig, anchor ? anchorToDate(anchor) : new Date());
  const plannedAttempts = plan.invoices.flatMap((i) => i.attempts.map((a) => ({ inv: i, a })));

  const events: SyncEvent[] = [];
  const t0 = Date.now();
  await syncFromBraintree((e) => events.push(e));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const last = events.at(-1)!;
  if (last.stage !== "done") {
    console.log(`✗ sync did not finish: ${JSON.stringify(last)}`);
    process.exit(1);
  }
  const s = last.summary;
  console.log(`Synced in ${secs}s from merchant ${s.merchantId}\n`);

  const txns: SyncedTransaction[] = JSON.parse(readFileSync(CACHE_FILE, "utf8")).transactions;
  const byOrder = new Map(txns.map((t) => [t.orderId, t]));

  check("progress events streamed (credentials → customers → transactions → done)",
    ["credentials", "customers", "transactions", "done"].every((st) => events.some((e) => e.stage === st)));
  check("customers match plan", s.customers === plan.customers.length, `${s.customers} vs ${plan.customers.length}`);
  check("transactions match plan", s.transactions === plannedAttempts.length, `${s.transactions} vs ${plannedAttempts.length}`);
  check("failed invoices match plan", s.failedInvoices === plan.invoices.length, `${s.failedInvoices} vs ${plan.invoices.length}`);
  check("history range matches plan",
    s.historyStart === plan.invoices.map((i) => i.billingDate).sort()[0] && s.historyEnd === plan.invoices.map((i) => i.billingDate).sort().at(-1),
    `${s.historyStart} → ${s.historyEnd}`);

  const codePairs = new Map<string, number>();
  let codeMismatch = 0, outcomeMismatch = 0, missing = 0, customMissing = 0;
  for (const { inv, a } of plannedAttempts) {
    const t = byOrder.get(`${inv.invoiceId}-a${a.attemptNo}`);
    if (!t) { missing++; continue; }
    const ok = t.status === "settled" || t.status === "submitted_for_settlement" || t.status === "settling";
    if (ok !== a.succeeds) outcomeMismatch++;
    if (!a.succeeds && t.processorResponseCode !== String(a.declineCode)) {
      codeMismatch++;
      codePairs.set(`${a.declineCode}→${t.processorResponseCode}/${t.cardBrand}`, (codePairs.get(`${a.declineCode}→${t.processorResponseCode}/${t.cardBrand}`) ?? 0) + 1);
    }
    if (t.custom.sm_invoice_id !== inv.invoiceId || t.custom.sm_billing_date !== inv.billingDate || t.custom.sm_invoice_amount !== inv.amount.toFixed(2)) customMissing++;
  }
  check("every planned attempt exists in Braintree", missing === 0, `${missing} missing`);
  check("every outcome (approved/declined) matches plan", outcomeMismatch === 0, `${outcomeMismatch} mismatched`);
  // Info only: the sandbox remaps some test amounts by card brand; Braintree's returned code is the source of truth.
  console.log(`ℹ declines returned a different code than planned: ${codeMismatch}`, [...codePairs].map(([k, n]) => `${k}×${n}`).join(" "));
  check("custom fields round-trip (invoice id, billing date, amount)", customMissing === 0, `${customMissing} wrong`);

  const recovered = plan.invoices.filter((i) => i.attempts.at(-1)!.succeeds);
  const settled = recovered.filter((i) => byOrder.get(`${i.invoiceId}-a${i.attempts.at(-1)!.attemptNo}`)?.status === "settled").length;
  check("recovered invoices are settled", settled === recovered.length, `${settled}/${recovered.length}`);
  const refunds = plan.invoices.filter((i) => i.refunded);
  const refunded = refunds.filter((i) => byOrder.get(`${i.invoiceId}-a${i.attempts.at(-1)!.attemptNo}`)?.refunded).length;
  check("planned refunds are refunded", refunded === refunds.length, `${refunded}/${refunds.length}`);

  const codes = [...new Set(txns.map((t) => t.processorResponseCode).filter((c) => c >= "2000"))].sort();
  check("decline mix covers 2000, 2001, 2004, 2015, 2046, 3000",
    ["2000", "2001", "2004", "2015", "2046", "3000"].every((c) => codes.includes(c)), codes.join(", "));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  process.exit(failures ? 1 : 0);
}

main();
