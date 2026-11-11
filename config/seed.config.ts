// Demo merchant settings. Change values here; the seed script and tests read only this file.

export const seedConfig = {
  randomSeed: 26,
  customers: 1000,
  historyDays: 90,
  currency: "USD",

  // Monthly SaaS plans. `weight` = share of customers on the plan.
  plans: [
    { key: "starter", name: "SecondMint Demo Starter", price: 29, weight: 0.55 },
    { key: "pro", name: "SecondMint Demo Pro", price: 99, weight: 0.35 },
    { key: "business", name: "SecondMint Demo Business", price: 299, weight: 0.1 },
  ],

  // Braintree sandbox test nonces used to vault each customer's card.
  cards: [
    { nonce: "fake-valid-visa-nonce", weight: 0.5 },
    { nonce: "fake-valid-mastercard-nonce", weight: 0.3 },
    { nonce: "fake-valid-amex-nonce", weight: 0.1 },
    { nonce: "fake-valid-discover-nonce", weight: 0.05 },
    { nonce: "fake-valid-debit-nonce", weight: 0.05 },
  ],

  // Chance that any single monthly renewal fails on its first attempt.
  renewalFailureRate: 0.35,

  // Decline mix for first failures. Codes are Braintree processor response codes.
  // `retrySuccess` = chance each retry succeeds (outcome model; the sandbox itself decides by amount).
  declineMix: [
    { code: 2001, weight: 0.4, retrySuccess: 0.18 }, // Insufficient funds (soft)
    { code: 2000, weight: 0.2, retrySuccess: 0.12 }, // Do not honor (soft)
    { code: 2046, weight: 0.14, retrySuccess: 0.1 }, // Declined (soft)
    { code: 2004, weight: 0.14, retrySuccess: 0 }, // Expired card (hard)
    { code: 2015, weight: 0.07, retrySuccess: 0 }, // Transaction not allowed (hard)
    { code: 3000, weight: 0.05, retrySuccess: 0.55 }, // Processor network unavailable (soft)
  ],

  // The merchant's existing recovery process: retry every N days, M times, for every decline code.
  existingProcess: { retryEveryDays: 3, maxRetries: 4 },

  // Share of recovered invoices later refunded.
  refundRate: 0.02,
} as const;

export type SeedConfig = typeof seedConfig;
