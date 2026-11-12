// Demo merchant settings. Change values here; the seed script and tests read only this file.

export const seedConfig = {
  randomSeed: 26,
  customers: 3000,
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
  // Decline mix for first failures: 85% soft / 15% hard (market: soft declines are 80–90% of failures, Paddle).
  // `retrySuccess` = chance one retry clears in the seeded history. 0.085 per retry over 4 retries recovers ~30% of soft
  // declines, the market rate for a fixed B2C schedule (Redux Payments: 25–35%). Not tuned to make trials conclusive.
  declineMix: [
    { code: 2001, weight: 0.43, retrySuccess: 0.085 }, // Insufficient funds (soft)
    { code: 2000, weight: 0.22, retrySuccess: 0.085 }, // Do not honor (soft)
    { code: 2046, weight: 0.15, retrySuccess: 0.085 }, // Declined (soft)
    { code: 2004, weight: 0.1, retrySuccess: 0 }, // Expired card (hard)
    { code: 2015, weight: 0.05, retrySuccess: 0 }, // Transaction not allowed (hard)
    { code: 3000, weight: 0.05, retrySuccess: 0.085 }, // Processor network unavailable (soft)
  ],

  // The merchant's existing recovery process: retry every N days, M times, for every decline code.
  existingProcess: { retryEveryDays: 3, maxRetries: 4 },

  // Share of recovered invoices later refunded.
  refundRate: 0.02,

  // Trial simulation (F4). Every number here is an assumption, not a measurement, and the Results report says so.
  // Odds depend only on the decline code, the day of the month and the failed retries so far: never on the route,
  // so any difference between routes comes from when each one retries.
  trialModel: {
    seed: "secondmint-trial-model-1", // fixes which renewals fail on which day; the trial's own seed only splits routes
    paydays: [1, 15], // days of the month when pay usually lands
    // Insufficient funds (2001): odds of one retry clearing. Pay clears on the payday itself; the next days are no better
    // than any other. Tuned with `npm run sweep:f4` so 16+ of 20 trials reach a verdict and Route A stays near the history.
    insufficientFunds: { onPayday: 0.95, afterPayday: 0.1, afterPaydayDays: 2, otherDay: 0.1, decayPerFailedRetry: 0.6 },
    // Other soft codes use declineMix[].retrySuccess on every retry, so their recovery matches the seeded history.
    routeB: {
      afterPaydayRetryDays: 2, // 2001: retry on the payday, then this many days later
      insufficientFundsFallbackDays: [3, 7, 11], // 2001 with no payday inside the recovery window
      networkRetryDays: [1, 2, 4, 7], // 3000: the outage is usually over by the next day
      otherSoftRetryDays: [2, 5, 9, 13],
    },
  },
} as const;

export type SeedConfig = typeof seedConfig;
