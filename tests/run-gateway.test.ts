import { test } from "node:test";
import assert from "node:assert/strict";
import { StandInGateway, standInToken } from "../src/lib/run/standin-gateway";
import type { SaleRequest } from "../src/lib/run/gateway";

const fields = (route = "A") => ({
  sm_invoice_id: "sm-tinv-0001-2026-11-01",
  sm_subscription_id: "sub-1",
  sm_billing_date: "2026-11-01",
  sm_attempt_at: "2026-11-01",
  sm_attempt_no: "0",
  sm_invoice_amount: "99.00",
  sm_route: route,
});
const sale = (amount: string, orderId: string, customFields: Record<string, string> = fields()): SaleRequest => ({
  paymentMethodToken: standInToken("sm-cust-0001"),
  amount,
  orderId,
  customFields,
});

test("2001.00 declines with code 2001", async () => {
  const r = await new StandInGateway().sale(sale("2001.00", "o1"));
  assert.equal(r.outcome, "declined");
  assert.equal(r.transaction?.processorResponseCode, "2001");
  assert.equal(r.transaction?.status, "processor_declined");
});

test("3000.00 fails with code 3000", async () => {
  const r = await new StandInGateway().sale(sale("3000.00", "o1"));
  assert.equal(r.outcome, "declined");
  assert.equal(r.transaction?.processorResponseCode, "3000");
});

test("99.00 is approved with a status the Diagnostic counts as approved", async () => {
  const r = await new StandInGateway().sale(sale("99.00", "o1"));
  assert.equal(r.outcome, "collected");
  assert.equal(r.transaction?.status, "submitted_for_settlement");
  assert.equal(r.transaction?.customerId, "sm-cust-0001");
  assert.equal(r.transaction?.custom.sm_route, "A");
});

test("the same order ID after an approval is rejected as a duplicate and creates no sale", async () => {
  const gw = new StandInGateway();
  await gw.sale(sale("99.00", "o1"));
  const again = await gw.sale(sale("99.00", "o1"));
  assert.equal(again.outcome, "rejected");
  assert.equal((await gw.findByOrderPrefix("o")).length, 1);
});

test("with the duplicate check off (a resend after 30 s), the same order ID creates a second sale", async () => {
  const gw = new StandInGateway({ duplicateCheck: false });
  await gw.sale(sale("99.00", "o1"));
  assert.equal((await gw.sale(sale("99.00", "o1"))).outcome, "collected");
  assert.equal((await gw.findByOrderPrefix("o1")).length, 2);
});

test("a sale without sm_route returns invalid with no transaction", async () => {
  const { sm_route: _drop, ...noRoute } = fields();
  const r = await new StandInGateway().sale(sale("99.00", "o1", noRoute));
  assert.equal(r.outcome, "invalid");
  assert.equal(r.transaction, null);
});

test("find-by-prefix returns exactly the sales sent under that prefix", async () => {
  const gw = new StandInGateway();
  await gw.sale(sale("2001.00", "sm-trial-r1-x-a0"));
  await gw.sale(sale("2001.00", "sm-trial-r1-y-a0"));
  await gw.sale(sale("2001.00", "sm-trial-r2-x-a0"));
  assert.deepEqual((await gw.findByOrderPrefix("sm-trial-r1-")).map((t) => t.orderId).sort(), ["sm-trial-r1-x-a0", "sm-trial-r1-y-a0"]);
});
