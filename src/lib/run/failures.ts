// Which renewals fail on each simulated trial day (F4). Same settings as the seeded history (config/seed.config.ts),
// keyed by the model seed, so the same renewals fail however customers are split between routes.

import { seedConfig } from "../../../config/seed.config";
import { dayOfMonth, isoDateOfDay, pickWeighted, uniform } from "./calendar";

export type TrialCustomer = {
  customerId: string;
  planKey: string;
  price: number;
  renewalDay: number; // day of the month the subscription renews, 1–28
  paymentMethodToken?: string; // filled from Braintree before day 0 (U6)
  subscriptionId?: string;
};

export type NewFailure = { invoiceId: string; customer: TrialCustomer; day: number; code: string };

const MODEL_SEED = seedConfig.trialModel.seed;

// The renewal day is derived from the customer ID; Braintree's own billing day is the day the seed ran.
export const renewalDayFor = (customerId: string) => 1 + Math.floor(uniform(MODEL_SEED, "renewal-day", customerId) * 28);

// Trial customers from IDs. Plans come from Braintree when known; otherwise they're drawn by the seed's plan weights.
export function trialCustomers(ids: string[], known: Map<string, Partial<TrialCustomer>> = new Map()): TrialCustomer[] {
  return ids.map((customerId) => {
    const plan = pickWeighted(seedConfig.plans, uniform(MODEL_SEED, "plan", customerId));
    return { customerId, planKey: plan.key, price: plan.price, renewalDay: renewalDayFor(customerId), ...known.get(customerId) };
  });
}

export const trialInvoiceId = (customerId: string, date: string) => `${customerId.replace(/^sm-cust-/, "sm-tinv-")}-${date}`;

export function failuresForDay(customers: TrialCustomer[], startDate: string, day: number): NewFailure[] {
  const dom = dayOfMonth(startDate, day);
  const date = isoDateOfDay(startDate, day);
  const out: NewFailure[] = [];
  for (const customer of customers) {
    if (customer.renewalDay !== dom) continue;
    if (uniform(MODEL_SEED, "renewal-fails", customer.customerId, date) >= seedConfig.renewalFailureRate) continue;
    const code = String(pickWeighted(seedConfig.declineMix, uniform(MODEL_SEED, "decline-code", customer.customerId, date)).code);
    out.push({ invoiceId: trialInvoiceId(customer.customerId, date), customer, day, code });
  }
  return out;
}
