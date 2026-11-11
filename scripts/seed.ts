// Creates the demo SaaS merchant in the Braintree sandbox: plans, customers with vaulted test cards,
// subscriptions, and the failed-renewal history (first failures, retries, recoveries, refunds).
//
// Usage: npm run seed            (resumes from .data/seed-progress.json if a previous run stopped)
//        npm run seed -- --fresh (ignores saved progress)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type braintree from "braintree";
import { seedConfig } from "../config/seed.config";
import { anchorToDate, buildSeedPlan, type PlannedInvoice } from "../src/lib/generator";
import { ConnectError, describeValidationErrors, getGateway, merchantAccountId, verifyCredentials } from "../src/lib/braintree";
import { runPool, withRetry } from "../src/lib/pool";

process.loadEnvFile?.(".env");

const CONCURRENCY = 8;
const PROGRESS_FILE = ".data/seed-progress.json";

type Progress = {
  anchorDate?: string; // UTC day the plan was first built; reused on resume so the plan never shifts
  planIds: Record<string, string>;
  customers: Record<string, { token: string; subscriptionId: string }>;
  attempts: Record<string, string>; // orderId -> transaction id
  settled: Record<string, true>;
  refunded: Record<string, true>;
  errors: string[];
};

function loadProgress(fresh: boolean): Progress {
  if (!fresh && existsSync(PROGRESS_FILE)) return JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  return { planIds: {}, customers: {}, attempts: {}, settled: {}, refunded: {}, errors: [] };
}

function saveProgress(p: Progress) {
  mkdirSync(".data", { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(p));
}

function log(msg: string) {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${msg}\n`);
}

async function ensurePlans(gw: braintree.BraintreeGateway, p: Progress) {
  const existing = (await withRetry(() => gw.plan.all())) as unknown as { plans: braintree.Plan[] };
  for (const plan of seedConfig.plans) {
    const found = existing.plans.find((x) => x.name === plan.name);
    if (found) {
      p.planIds[plan.key] = found.id;
      continue;
    }
    const attrs = { name: plan.name, price: plan.price.toFixed(2), billingFrequency: 1, currencyIsoCode: seedConfig.currency };
    const res = (await withRetry(() => gw.plan.create({ id: `sm-${plan.key}`, ...attrs } as never))) as unknown as {
      success: boolean;
      plan?: braintree.Plan;
      message?: string;
    };
    if (!res.success || !res.plan) throw new ConnectError(`Couldn't create plan "${plan.name}"`, res.message ?? "Create it in Control Panel → Plans, then rerun.");
    p.planIds[plan.key] = res.plan.id;
  }
  log(`Plans ready: ${Object.values(p.planIds).join(", ")}`);
}

// One declined sale using every custom field. Catches missing Control Panel setup before the bulk run.
async function preflightCustomFields(gw: braintree.BraintreeGateway) {
  const res = await withRetry(() =>
    gw.transaction.sale({
      amount: "2001.00",
      paymentMethodNonce: "fake-valid-visa-nonce",
      orderId: "sm-preflight",
      merchantAccountId: merchantAccountId(),
      customFields: {
        sm_invoice_id: "preflight",
        sm_subscription_id: "preflight",
        sm_billing_date: "2026-01-01",
        sm_attempt_at: "2026-01-01",
        sm_attempt_no: "0",
        sm_invoice_amount: "0.00",
      },
    }),
  );
  if (!res.transaction) {
    throw new ConnectError(
      "Sandbox custom fields aren't set up",
      `Braintree said: ${describeValidationErrors(res as never) || res.message}. In Control Panel → Settings → Processing → Custom Fields, add each sm_* field (see README) with "Store and pass back".`,
    );
  }
}

async function seedCustomers(gw: braintree.BraintreeGateway, p: Progress, plan: ReturnType<typeof buildSeedPlan>) {
  const todo = plan.customers.filter((c) => !p.customers[c.id]);
  let done = plan.customers.length - todo.length;
  await runPool(todo, CONCURRENCY, async (c) => {
    try {
      let token: string;
      const res = await withRetry(() =>
        gw.customer.create({
          id: c.id,
          firstName: "Demo",
          lastName: `Customer ${c.id.slice(-4)}`,
          email: `${c.id}@example.com`,
          paymentMethodNonce: c.cardNonce,
        }),
      );
      if (res.success) token = res.customer.paymentMethods![0].token!;
      else {
        // Already created by an earlier run that stopped before saving progress.
        const existing = await withRetry(() => gw.customer.find(c.id));
        token = existing.paymentMethods![0].token!;
      }
      const sub = await withRetry(() =>
        gw.subscription.create({ paymentMethodToken: token, planId: p.planIds[c.planKey], merchantAccountId: merchantAccountId() }),
      );
      if (!sub.success) throw new Error(`subscription: ${sub.message}`);
      p.customers[c.id] = { token, subscriptionId: sub.subscription.id };
    } catch (err) {
      p.errors.push(`${c.id}: ${(err as Error).message}`);
    }
    if (++done % 50 === 0) {
      log(`Customers + subscriptions: ${done}/${plan.customers.length}`);
      saveProgress(p);
    }
  });
  saveProgress(p);
  log(`Customers + subscriptions: ${Object.keys(p.customers).length}/${plan.customers.length}`);
}

async function seedAttempts(gw: braintree.BraintreeGateway, p: Progress, invoices: PlannedInvoice[]) {
  const maxRound = Math.max(...invoices.map((i) => i.attempts.length));
  // Chronological rounds: every first attempt, then every first retry, and so on.
  // Keeps repeat charges on the same card minutes apart, away from duplicate-transaction checks.
  for (let round = 0; round < maxRound; round++) {
    const work = invoices
      .filter((inv) => inv.attempts[round] && p.customers[inv.customerId])
      .map((inv) => ({ inv, a: inv.attempts[round] }))
      .filter(({ inv, a }) => !p.attempts[`${inv.invoiceId}-a${a.attemptNo}`]);
    let done = 0;
    await runPool(work, CONCURRENCY, async ({ inv, a }) => {
      const orderId = `${inv.invoiceId}-a${a.attemptNo}`;
      const cust = p.customers[inv.customerId];
      try {
        const res = await withRetry(() =>
          gw.transaction.sale({
            amount: a.sandboxAmount,
            paymentMethodToken: cust.token,
            orderId,
            merchantAccountId: merchantAccountId(),
            customFields: {
              sm_invoice_id: inv.invoiceId,
              sm_subscription_id: cust.subscriptionId,
              sm_billing_date: inv.billingDate,
              sm_attempt_at: a.attemptAt,
              sm_attempt_no: String(a.attemptNo),
              sm_invoice_amount: inv.amount.toFixed(2),
            },
            options: { submitForSettlement: true },
          }),
        );
        if (!res.transaction) throw new Error(describeValidationErrors(res as never) || res.message);
        // Rejected by the gateway (e.g. duplicate check): never reached the bank, so not part of the history. Retried on rerun.
        if (res.transaction.status === "gateway_rejected") throw new Error(`gateway rejected: ${res.transaction.gatewayRejectionReason}`);
        p.attempts[orderId] = res.transaction.id;
        if (res.success !== a.succeeds) p.errors.push(`${orderId}: expected ${a.succeeds ? "success" : "decline"}, got ${res.transaction.status}`);
      } catch (err) {
        p.errors.push(`${orderId}: ${(err as Error).message}`);
      }
      if (++done % 100 === 0) {
        log(`Round ${round}: ${done}/${work.length} attempts`);
        saveProgress(p);
      }
    });
    saveProgress(p);
    log(`Round ${round} done: ${work.length} attempts`);
  }
}

async function settleAndRefund(gw: braintree.BraintreeGateway, p: Progress, invoices: PlannedInvoice[]) {
  const recovered = invoices
    .map((inv) => ({ inv, last: inv.attempts[inv.attempts.length - 1] }))
    .filter(({ last }) => last.succeeds)
    .map(({ inv, last }) => ({ inv, txnId: p.attempts[`${inv.invoiceId}-a${last.attemptNo}`] }))
    .filter((x) => x.txnId);
  await runPool(recovered, CONCURRENCY, async ({ inv, txnId }) => {
    try {
      if (!p.settled[txnId]) {
        await withRetry(() => gw.testing.settle(txnId));
        p.settled[txnId] = true;
      }
      if (inv.refunded && !p.refunded[txnId]) {
        const r = await withRetry(() => gw.transaction.refund(txnId));
        if (!r.success) throw new Error(`refund: ${r.message}`);
        p.refunded[txnId] = true;
      }
    } catch (err) {
      p.errors.push(`${inv.invoiceId} settle/refund: ${(err as Error).message}`);
    }
  });
  saveProgress(p);
  log(`Recovered invoices settled: ${Object.keys(p.settled).length}, refunded: ${Object.keys(p.refunded).length}`);
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  const gw = getGateway();
  await verifyCredentials(gw);
  log("Credentials OK");

  const p = loadProgress(fresh);
  p.errors = []; // errors are per run; anything that failed before is retried below
  p.anchorDate ??= new Date().toISOString().slice(0, 10);
  const plan = buildSeedPlan(seedConfig, anchorToDate(p.anchorDate));
  const attempts = plan.invoices.reduce((s, i) => s + i.attempts.length, 0);
  log(`Plan: ${plan.customers.length} customers, ${plan.invoices.length} failed invoices, ${attempts} attempts (${plan.historyStart} → ${plan.historyEnd})`);

  await ensurePlans(gw, p);
  await preflightCustomFields(gw);
  log("Custom fields OK");
  await seedCustomers(gw, p, plan);
  await seedAttempts(gw, p, plan.invoices);
  await settleAndRefund(gw, p, plan.invoices);

  log(`Done. Errors: ${p.errors.length}${p.errors.length ? ` (first: ${p.errors.slice(0, 3).join(" | ")})` : ""}`);
  if (p.errors.length) log(`Full list in ${PROGRESS_FILE}. Rerun "npm run seed" to retry anything missing.`);
}

main().catch((err) => {
  if (err instanceof ConnectError) console.error(`\n✗ ${err.title}\n  ${err.fix}\n`);
  else console.error(err);
  process.exit(1);
});
