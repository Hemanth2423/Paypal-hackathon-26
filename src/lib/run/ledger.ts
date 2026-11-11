// The trial's outcome ledger (F4): one JSON line per sandbox sale, appended as each call returns, in the same
// shape as a synced transaction so the Diagnostic's invoice builder reads it unchanged.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Route } from "../trial";
import type { SyncedTransaction } from "../sync";
import { isApproved } from "./gateway";

export type LedgerRecord = SyncedTransaction & { runId: string; route: Route; day: number };

export class Ledger {
  readonly records: LedgerRecord[] = [];

  constructor(readonly file: string) {
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        this.records.push(JSON.parse(line) as LedgerRecord);
      } catch {
        // A line cut off by a crash mid-write: the sale behind it is recovered from the gateway on resume.
      }
    }
    // Start the next append on a fresh line if the file ends mid-record.
    if (text.length && !text.endsWith("\n")) appendFileSync(file, "\n");
  }

  append(rec: LedgerRecord) {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(rec) + "\n");
    this.records.push(rec);
  }

  hasTransaction(id: string) {
    return this.records.some((r) => r.id === id);
  }

  // Invoices with more than one approved sale. Must be 0.
  duplicateCollections(): number {
    return countDuplicates(this.records);
  }
}

export function countDuplicates(txns: Pick<SyncedTransaction, "status" | "custom">[]): number {
  const approved = new Map<string, number>();
  for (const t of txns) if (isApproved(t)) approved.set(t.custom.sm_invoice_id, (approved.get(t.custom.sm_invoice_id) ?? 0) + 1);
  return [...approved.values()].filter((n) => n > 1).length;
}
