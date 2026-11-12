// Wallet experiment constants (F8), safe to import in the browser.

export const FEES = { card: { pct: 0.029, fixed: 0.3 }, paypal: { pct: 0.0349, fixed: 0.49 } };

export type WalletAssumptions = {
  baselineCompletion: number; // share of control customers who complete the card-only update page
  relativeLift: number; // relative lift in completion from adding a PayPal button
  paypalShare: number; // share of treatment payers who choose PayPal
  nextFailCard: number; // next-renewal failure rate on a saved card
  nextFailWallet: number; // next-renewal failure rate on a saved PayPal wallet
};

export const DEFAULT_WALLET_ASSUMPTIONS: WalletAssumptions = {
  baselineCompletion: 0.25,
  relativeLift: 0.09,
  paypalShare: 0.3,
  nextFailCard: 0.1,
  nextFailWallet: 0.1,
};

export const WALLET_INFO: Record<keyof WalletAssumptions, { label: string; unit: "%" | "% rel."; source: string; min: number; max: number }> = {
  baselineCompletion: { label: "Customers who complete the card-only update page", unit: "%", source: "No public benchmark found. Enter your own dunning completion rate.", min: 0.01, max: 0.95 },
  relativeLift: { label: "Lift from adding a PayPal button (relative)", unit: "% rel.", source: "Kofax independent A/B test: +8.75% conversion (2Checkout case study). PayPal/Nielsen: ~+10% average (PayPal-commissioned).", min: -0.5, max: 1 },
  paypalShare: { label: "Treatment payers who choose PayPal", unit: "%", source: "No public benchmark; varies by merchant and audience.", min: 0, max: 1 },
  nextFailCard: { label: "Next-renewal failure, saved card", unit: "%", source: "Braintree: an acceptable decline ratio is about 10% of transactions.", min: 0, max: 0.9 },
  nextFailWallet: { label: "Next-renewal failure, saved PayPal wallet", unit: "%", source: "Default equals card (no assumed advantage). Home Chef reports ~30% fewer failed payments with PayPal (vendor case study).", min: 0, max: 0.9 },
};

export const WALLET_READINESS = {
  consent: "Merchant consent and trial terms accepted",
  samePage: "Price, message and card form are identical in both groups",
  preRegistered: "Sample size and duration set before the start",
  separate: "Not running at the same time as the retry trial on these customers",
} as const;

