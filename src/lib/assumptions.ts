// Simulation assumptions the merchant can edit on the trial setup screen (F3). Defaults come from published market
// benchmarks (sources below), not from tuning the model until a trial "wins". Every simulated outcome traces to these.

export type Assumptions = {
  renewalFailureRate: number; // share of renewals whose first charge fails
  softShare: number; // share of failures that are soft (retryable)
  currentRecovery: number; // share of soft declines the current fixed schedule recovers within the window
  smartUplift: number; // extra recovery (absolute) from smart retries on Route B
};

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  renewalFailureRate: 0.35, // demo value, above market, so a 3,000-customer merchant generates enough failures
  softShare: 0.85,
  currentRecovery: 0.3,
  smartUplift: 0.07, // Stripe x InVideo: Smart Retries took recovery from 23% to 30%
};

export const ASSUMPTION_INFO: Record<keyof Assumptions, { label: string; market: string; source: string; min: number; max: number }> = {
  renewalFailureRate: {
    label: "Renewals that fail on first charge",
    market: "Market: about 10%. Demo default is 35% so a small demo merchant produces enough failures to test.",
    source: "Braintree: an acceptable decline ratio is about 10% of transactions.",
    min: 0.01,
    max: 0.6,
  },
  softShare: {
    label: "Failures that are soft (retryable)",
    market: "Market: 80–90%.",
    source: "Paddle, “How to prevent soft declines”: soft declines are 80–90% of payment failures.",
    min: 0.5,
    max: 0.99,
  },
  currentRecovery: {
    label: "Soft declines your current process recovers",
    market: "Market: 25–35% for B2C fixed schedules; ~50–55% with Stripe or Recurly retry tools.",
    source: "Redux Payments (200+ B2C Stripe accounts): 25–35%. Churnkey: 51% with Stripe retries.",
    min: 0.05,
    max: 0.9,
  },
  smartUplift: {
    label: "Smart Retries uplift (Route B, assumed)",
    market: "Real-world: Stripe Smart Retries raised InVideo's failed-renewal recovery from 23% to 30% (+7 pp). Market range: +4 pp (Churnkey) to +10–20 pp (Recurly).",
    source: "Stripe customer story: InVideo (stripe.com/customers/invideo). Churnkey and Recurly recovery benchmarks.",
    min: 0,
    max: 0.3,
  },
};

export function clampAssumptions(a: Partial<Assumptions> | undefined, base: Assumptions = DEFAULT_ASSUMPTIONS): Assumptions {
  const out = { ...base };
  for (const k of Object.keys(ASSUMPTION_INFO) as (keyof Assumptions)[]) {
    const v = Number(a?.[k]);
    if (Number.isFinite(v)) out[k] = Math.min(ASSUMPTION_INFO[k].max, Math.max(ASSUMPTION_INFO[k].min, +v.toFixed(3)));
  }
  out.smartUplift = Math.min(out.smartUplift, 0.99 - out.currentRecovery);
  return out;
}

// Per-retry success odds that give `rate` recovery over `retries` independent tries: 1 − (1 − rate)^(1/retries).
export const perRetryOdds = (rate: number, retries: number) => 1 - (1 - Math.min(0.99, Math.max(0, rate))) ** (1 / retries);

// The assumptions the running trial uses. Set from the saved trial when a run starts.
let active: Assumptions = DEFAULT_ASSUMPTIONS;
export const activeAssumptions = () => active;
export const setActiveAssumptions = (a: Partial<Assumptions> | undefined) => {
  active = clampAssumptions(a);
};

// The merchant's current retry schedule (Route A). Route B gets the same maximum number of tries.
export type RetryPolicy = { retryEveryDays: number; maxRetries: number };
export const DEFAULT_POLICY: RetryPolicy = { retryEveryDays: 3, maxRetries: 4 };
export const POLICY_LIMITS = { retryEveryDays: { min: 1, max: 14 }, maxRetries: { min: 1, max: 8 } };

export function clampPolicy(p: Partial<RetryPolicy> | undefined, base: RetryPolicy = DEFAULT_POLICY): RetryPolicy {
  const c = (v: unknown, k: keyof RetryPolicy) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(POLICY_LIMITS[k].max, Math.max(POLICY_LIMITS[k].min, n)) : base[k];
  };
  return { retryEveryDays: c(p?.retryEveryDays ?? base.retryEveryDays, "retryEveryDays"), maxRetries: c(p?.maxRetries ?? base.maxRetries, "maxRetries") };
}

let activePolicy: RetryPolicy = DEFAULT_POLICY;
export const getActivePolicy = () => activePolicy;
export const setActivePolicy = (p: Partial<RetryPolicy> | undefined) => {
  activePolicy = clampPolicy(p);
};
