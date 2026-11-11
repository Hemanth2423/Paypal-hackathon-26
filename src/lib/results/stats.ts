// Statistics for the results report (F5). No dependencies.

const Z95 = 1.959963984540054;

export type Interval = { low: number; high: number };

// Wilson score interval for one proportion.
export function wilsonInterval(successes: number, n: number, z = Z95): Interval {
  if (n <= 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

// 95% interval for the uplift pB − pA by Newcombe's hybrid score method, which holds up at small samples
// and at rates near 0 or 1. Null when either route has no invoices.
export function newcombeInterval(xA: number, nA: number, xB: number, nB: number): Interval | null {
  if (nA <= 0 || nB <= 0) return null;
  const pA = xA / nA;
  const pB = xB / nB;
  const a = wilsonInterval(xA, nA);
  const b = wilsonInterval(xB, nB);
  const diff = pB - pA;
  return {
    low: diff - Math.sqrt((pB - b.low) ** 2 + (a.high - pA) ** 2),
    high: diff + Math.sqrt((b.high - pB) ** 2 + (pA - a.low) ** 2),
  };
}

// Standard normal CDF (Abramowitz and Stegun 7.1.26; absolute error under 1.5e-7).
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

// Two-sided, pooled two-proportion z-test of pB vs pA. Null when either route has no invoices.
export function twoProportionZTest(xA: number, nA: number, xB: number, nB: number): { z: number; pValue: number } | null {
  if (nA <= 0 || nB <= 0) return null;
  const pooled = (xA + xB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (se === 0) return { z: 0, pValue: 1 }; // both routes all-recovered or all-lost: no evidence of a difference
  const z = (xB / nB - xA / nA) / se;
  return { z, pValue: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))) };
}
