// Decline rules (TechSpec §4). Soft/hard from Braintree's decline guide; retry caps from Visa's retry rules
// as documented by Braintree (Category 1: do not retry; Categories 2–4: max 15 retries per 30 days).

export type DeclineRule = {
  code: string;
  name: string;
  type: "soft" | "hard";
  networkCategory: string; // Visa retry category
  retryCap: number | null; // max retries per 30 days per card; null = no network cap
};

export const EXCESS_RETRY_FEE = 0.1; // USD per retry over the cap (Visa domestic, per Braintree docs)

const RULES: Record<string, DeclineRule> = {
  "2000": { code: "2000", name: "Do not honor", type: "soft", networkCategory: "Visa 2–4", retryCap: 15 },
  "2001": { code: "2001", name: "Insufficient funds", type: "soft", networkCategory: "Visa 2–4", retryCap: 15 },
  "2004": { code: "2004", name: "Expired card", type: "hard", networkCategory: "Visa 2–4", retryCap: 15 },
  "2015": { code: "2015", name: "Transaction not allowed", type: "hard", networkCategory: "Visa 1 (do not retry)", retryCap: 0 },
  "2046": { code: "2046", name: "Declined", type: "soft", networkCategory: "Visa 2–4", retryCap: 15 },
  "3000": { code: "3000", name: "Processor network unavailable", type: "soft", networkCategory: "None (gateway)", retryCap: null },
};

export const ALL_RULES = Object.values(RULES);

// Unknown codes: Braintree treats 2109–2999 as generic soft declines.
export function ruleFor(code: string, text = ""): DeclineRule {
  return RULES[code] ?? { code, name: text || `Code ${code}`, type: "soft", networkCategory: "Unknown", retryCap: 15 };
}

export const label = (r: DeclineRule) => `${r.code} · ${r.name}`;
