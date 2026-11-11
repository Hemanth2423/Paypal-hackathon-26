import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type braintree from "braintree";
import { BraintreeTrialGateway, loadBraintreeCustomers } from "../src/lib/run/braintree-gateway";
import type { SaleRequest } from "../src/lib/run/gateway";

const txn = (status: string, code: string, extra: Record<string, unknown> = {}) => ({
  id: "t1",
  orderId: "sm-trial-r1-inv-a0",
  type: "sale",
  status,
  amount: "29.00",
  currencyIsoCode: "USD",
  processorResponseCode: code,
  processorResponseText: "text",
  merchantAccountId: "ucb",
  customer: { id: "sm-cust-0001" },
  creditCard: { cardType: "Visa", last4: "1111", debit: "No" },
  refundIds: [],
  createdAt: "2026-11-11",
  customFields: { smInvoiceId: "inv", smRoute: "B", smAttemptNo: "0" },
  ...extra,
});
function fakeGateway(response: unknown, customers: unknown[] = []) {
  const sent: Record<string, unknown>[] = [];
  const gw = {
    transaction: {
      sale: async (req: Record<string, unknown>) => (sent.push(req), response),
      search: () => Readable.from([txn("submitted_for_settlement", "1000")]),
    },
    customer: { search: () => Readable.from(customers) },
  } as unknown as braintree.BraintreeGateway;
  return { gw, sent };
}
const req: SaleRequest = { paymentMethodToken: "tok", amount: "29.00", orderId: "sm-trial-r1-inv-a0", customFields: { sm_route: "B", sm_invoice_id: "inv" } };

test("SDK results map to the engine's four outcomes", async () => {
  const cases: [unknown, string][] = [
    [{ success: true, transaction: txn("submitted_for_settlement", "1000") }, "collected"],
    [{ success: false, transaction: txn("processor_declined", "2001") }, "declined"],
    [{ success: false, transaction: txn("failed", "3000") }, "declined"],
    [{ success: false, transaction: txn("gateway_rejected", "", { gatewayRejectionReason: "duplicate" }) }, "rejected"],
    [{ success: false, message: "Custom field is invalid: sm_route", errors: { deepErrors: () => [{ attribute: "custom_fields", message: "Custom field is invalid: sm_route" }] } }, "invalid"],
  ];
  for (const [response, outcome] of cases) {
    const r = await new BraintreeTrialGateway(fakeGateway(response).gw).sale(req);
    assert.equal(r.outcome, outcome);
  }
});

test("a collected sale comes back in the sync's record shape, with snake_case custom fields", async () => {
  const r = await new BraintreeTrialGateway(fakeGateway({ success: true, transaction: txn("submitted_for_settlement", "1000") }).gw).sale(req);
  assert.equal(r.transaction?.customerId, "sm-cust-0001");
  assert.equal(r.transaction?.custom.sm_route, "B");
  assert.equal(r.transaction?.custom.sm_invoice_id, "inv");
});

test("a duplicate rejection carries the reason the engine looks for", async () => {
  const r = await new BraintreeTrialGateway(fakeGateway({ success: false, transaction: txn("gateway_rejected", "", { gatewayRejectionReason: "duplicate" }) }).gw).sale(req);
  assert.match(r.message ?? "", /duplicate/);
});

test("Route B's merchant account and the route tag are sent when set", async () => {
  const { gw, sent } = fakeGateway({ success: true, transaction: txn("submitted_for_settlement", "1000") });
  await new BraintreeTrialGateway(gw).sale({ ...req, merchantAccountId: "route-b-account" });
  assert.equal(sent[0].merchantAccountId, "route-b-account");
  assert.equal((sent[0].customFields as Record<string, string>).sm_route, "B");
  assert.deepEqual(sent[0].options, { submitForSettlement: true });
});

test("customers load their card, subscription and price; a customer with no card is named", async () => {
  const withCard = { id: "sm-cust-0001", creditCards: [{ token: "tok1", subscriptions: [{ id: "sub1", status: "Active", price: "99.00" }] }] };
  const noCard = { id: "sm-cust-0002", creditCards: [] };
  const ok = await loadBraintreeCustomers(["sm-cust-0001"], new BraintreeTrialGateway(fakeGateway(null, [withCard, noCard]).gw));
  assert.deepEqual([ok[0].paymentMethodToken, ok[0].subscriptionId, ok[0].price], ["tok1", "sub1", 99]);
  await assert.rejects(
    loadBraintreeCustomers(["sm-cust-0001", "sm-cust-0002"], new BraintreeTrialGateway(fakeGateway(null, [withCard, noCard]).gw)),
    /sm-cust-0002/,
  );
});
