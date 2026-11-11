// The verdict rules from Product.md F5. Rules decide the verdict; the AI never does.

export type Verdict = "paypal_wins" | "current_wins" | "inconclusive";

export const VERDICT_LABEL: Record<Verdict, string> = {
  paypal_wins: "PayPal route wins",
  current_wins: "Current route wins",
  inconclusive: "Inconclusive: extend the trial",
};

export type VerdictInput = {
  ciLow: number | null; // 95% interval of the uplift (Route B rate − Route A rate)
  ciHigh: number | null;
  netDifference: number | null; // net recovered $ per eligible invoice, Route B − Route A
};

export type VerdictResult = { verdict: Verdict; label: string; reason: string };

export function decideVerdict({ ciLow, ciHigh, netDifference }: VerdictInput): VerdictResult {
  const result = (verdict: Verdict, reason: string): VerdictResult => ({ verdict, label: VERDICT_LABEL[verdict], reason });
  if (ciLow == null || ciHigh == null || netDifference == null)
    return result("inconclusive", "One route has no failed invoices with a closed recovery window.");
  if (ciLow > 0 && netDifference > 0)
    return result("paypal_wins", "The whole 95% interval for the uplift is above zero, and the PayPal route kept more net revenue.");
  if (ciHigh < 0) return result("current_wins", "The whole 95% interval for the uplift is below zero.");
  if (ciLow > 0) return result("inconclusive", "The PayPal route recovered more invoices, but it did not keep more net revenue.");
  return result("inconclusive", "The 95% interval for the uplift includes zero, so the difference could be chance.");
}
