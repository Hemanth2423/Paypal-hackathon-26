// Stand-in for the Braintree sandbox (F4), used when TRIAL_GATEWAY=standin. It follows the sandbox's amount rules,
// rejects a repeated order ID after an approval (the sandbox's duplicate check), and refuses a sale whose route
// custom field is missing, so the engine behaves the same against either one. Its records say they're stand-in data.

import type { SyncedTransaction } from "../sync";
import type { SaleRequest, SaleResult, TrialGateway } from "./gateway";

export const STANDIN_PREFIX = "standin-";
export const standInToken = (customerId: string) => `${STANDIN_PREFIX}${customerId}`;

const DECLINE_TEXT: Record<string, string> = {
  "2000": "Do Not Honor",
  "2001": "Insufficient Funds",
  "2004": "Expired Card",
  "2015": "Transaction Not Allowed",
  "2046": "Declined",
  "3000": "Processor Network Unavailable - Try Again",
};

export type StandInOptions = {
  duplicateCheck?: boolean; // off stands for a resend after the sandbox's 30-second window
  latencyMs?: number;
};

export class StandInGateway implements TrialGateway {
  readonly kind = "standin" as const;
  private readonly sales: SyncedTransaction[] = [];
  private seq = 0;
  private failures = 0;

  constructor(private readonly options: StandInOptions = {}) {}

  // The next `count` calls throw the error the Braintree SDK throws when throttled.
  throttleNext(count: number) {
    this.failures = count;
  }

  private async pause() {
    if (this.options.latencyMs) await new Promise((r) => setTimeout(r, this.options.latencyMs));
    if (this.failures > 0) {
      this.failures--;
      throw Object.assign(new Error("Too many requests"), { type: "tooManyRequestsError" });
    }
  }

  async sale(req: SaleRequest): Promise<SaleResult> {
    await this.pause();
    if (!req.customFields.sm_route) return { outcome: "invalid", transaction: null, message: "Custom field is invalid: sm_route" };
    const duplicateCheck = this.options.duplicateCheck ?? true;
    if (duplicateCheck && this.sales.some((t) => t.orderId === req.orderId && t.status === "submitted_for_settlement"))
      return { outcome: "rejected", transaction: null, message: "Gateway Rejected: duplicate" };

    const amount = Number(req.amount);
    const declineCode = amount >= 2000 && amount < 3001 ? String(Math.floor(amount)) : null;
    const t: SyncedTransaction = {
      id: `standin_${(++this.seq).toString(36).padStart(6, "0")}`,
      orderId: req.orderId,
      status: declineCode === "3000" ? "failed" : declineCode ? "processor_declined" : "submitted_for_settlement",
      amount: req.amount,
      currency: "USD",
      processorResponseCode: declineCode ?? "1000",
      processorResponseText: declineCode ? (DECLINE_TEXT[declineCode] ?? "Declined") : "Approved",
      merchantAccountId: req.merchantAccountId ?? "standin",
      customerId: req.paymentMethodToken.startsWith(STANDIN_PREFIX) ? req.paymentMethodToken.slice(STANDIN_PREFIX.length) : null,
      cardBrand: "Visa",
      cardDebit: "No",
      cardLast4: "1111",
      refunded: false,
      createdAt: new Date().toISOString(),
      custom: { ...req.customFields },
    };
    this.sales.push(t);
    return { outcome: declineCode ? "declined" : "collected", transaction: t };
  }

  async findByOrderPrefix(prefix: string): Promise<SyncedTransaction[]> {
    await this.pause();
    return this.sales.filter((t) => t.orderId.startsWith(prefix));
  }
}
