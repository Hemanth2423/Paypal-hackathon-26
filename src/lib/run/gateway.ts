// The trial engine's only door to a payment processor (F4). Two implementations: the Braintree sandbox (U6) and a
// stand-in that follows the sandbox's amount rules for building and testing without keys.

import type { SyncedTransaction } from "../sync";

export type SaleRequest = {
  paymentMethodToken: string;
  amount: string; // two decimals; a decline is encoded as the sandbox test amount for its code
  orderId: string;
  merchantAccountId?: string;
  customFields: Record<string, string>;
};

// collected: approved. declined: the bank said no. rejected: the gateway refused it (e.g. duplicate check).
// invalid: no transaction was created (e.g. a custom field isn't set up).
export type SaleOutcome = "collected" | "declined" | "rejected" | "invalid";
export type SaleResult = { outcome: SaleOutcome; transaction: SyncedTransaction | null; message?: string };

export type GatewayKind = "standin" | "braintree";

export interface TrialGateway {
  kind: GatewayKind;
  sale(req: SaleRequest): Promise<SaleResult>;
  findByOrderPrefix(prefix: string): Promise<SyncedTransaction[]>;
}

// Statuses the Diagnostic counts as a collected payment (src/lib/diagnostic.ts).
export const APPROVED_STATUSES = new Set(["settled", "settling", "submitted_for_settlement", "authorized"]);
export const isApproved = (t: Pick<SyncedTransaction, "status">) => APPROVED_STATUSES.has(t.status);

// The data-source banner. A stand-in run must never be labelled as sandbox data.
export const dataSourceLabel = () =>
  process.env.TRIAL_GATEWAY === "standin" ? "Stand-in data · simulated outcomes" : "Sandbox data · simulated outcomes";
