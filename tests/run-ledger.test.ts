import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInvoices } from "../src/lib/diagnostic";
import { Ledger, type LedgerRecord } from "../src/lib/run/ledger";

const file = () => join(mkdtempSync(join(tmpdir(), "sm-ledger-")), "trial-ledger.jsonl");

function rec(invoice: string, attemptNo: number, status: string, code: string, extra: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    id: `t-${invoice}-${attemptNo}-${status}`,
    orderId: `sm-trial-r1-${invoice}-a${attemptNo}`,
    status,
    amount: status === "submitted_for_settlement" ? "99.00" : `${code}.00`,
    currency: "USD",
    processorResponseCode: code,
    processorResponseText: "",
    merchantAccountId: "standin",
    customerId: "sm-cust-0001",
    cardBrand: "Visa",
    cardDebit: "No",
    cardLast4: "1111",
    refunded: false,
    createdAt: "2026-11-11T00:00:00Z",
    custom: {
      sm_invoice_id: invoice,
      sm_subscription_id: "sub-1",
      sm_billing_date: "2026-11-01",
      sm_attempt_at: `2026-11-0${1 + attemptNo}`,
      sm_attempt_no: String(attemptNo),
      sm_invoice_amount: "99.00",
      sm_route: "B",
    },
    runId: "r1",
    route: "B",
    day: attemptNo,
    ...extra,
  };
}

test("appended records read back in order after a reload", () => {
  const f = file();
  const l = new Ledger(f);
  l.append(rec("inv-1", 0, "processor_declined", "2001"));
  l.append(rec("inv-1", 1, "processor_declined", "2001"));
  l.append(rec("inv-1", 2, "submitted_for_settlement", "1000"));
  assert.deepEqual(new Ledger(f).records.map((r) => r.custom.sm_attempt_no), ["0", "1", "2"]);
});

test("a file whose last line was cut mid-record loads the complete records", () => {
  const f = file();
  const l = new Ledger(f);
  l.append(rec("inv-1", 0, "processor_declined", "2001"));
  appendFileSync(f, JSON.stringify(rec("inv-1", 1, "processor_declined", "2001")).slice(0, 40));
  const reloaded = new Ledger(f);
  assert.equal(reloaded.records.length, 1);
  reloaded.append(rec("inv-1", 1, "processor_declined", "2001"));
  assert.equal(new Ledger(f).records.length, 2, "a later append still lands on its own line");
  assert.ok(readFileSync(f, "utf8").endsWith("\n"));
});

test("records feed the Diagnostic's invoice builder: one invoice per sm_invoice_id", () => {
  const l = new Ledger(file());
  l.append(rec("inv-1", 0, "processor_declined", "2001"));
  l.append(rec("inv-1", 1, "submitted_for_settlement", "1000"));
  l.append(rec("inv-2", 0, "processor_declined", "2000"));
  const invoices = buildInvoices(l.records, "2026-12-31");
  assert.equal(invoices.length, 2);
  const one = invoices.find((i) => i.invoiceId === "inv-1")!;
  assert.equal(one.firstCode, "2001");
  assert.equal(one.attempts.length, 2);
  assert.equal(one.status, "recovered");
});

test("two collections on one invoice are both kept, and the audit reports one duplicate", () => {
  const l = new Ledger(file());
  l.append(rec("inv-1", 1, "submitted_for_settlement", "1000"));
  l.append(rec("inv-1", 1, "submitted_for_settlement", "1000", { id: "t-second" }));
  assert.equal(l.records.length, 2);
  assert.equal(l.duplicateCollections(), 1);
});
