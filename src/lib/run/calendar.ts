// Simulated trial calendar (F4). Day 0 is the trial's start date; every date is a UTC calendar day.

import { createHash } from "node:crypto";

const DAY = 86_400_000;

export function dateOfDay(startDate: string, day: number): Date {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start)) throw new Error(`Invalid trial start date: ${startDate}`);
  return new Date(start + day * DAY);
}

export const isoDateOfDay = (startDate: string, day: number) => dateOfDay(startDate, day).toISOString().slice(0, 10);
export const dayOfMonth = (startDate: string, day: number) => dateOfDay(startDate, day).getUTCDate();

// A repeatable number in [0, 1) for a set of labels. Each simulated decision draws from its own labels,
// so results don't depend on the order in which sandbox calls finish.
export function uniform(...parts: string[]): number {
  return createHash("sha256").update(parts.join("|")).digest().readUIntBE(0, 6) / 2 ** 48;
}

// Picks an item by weight using a draw in [0, 1).
export function pickWeighted<T extends { weight: number }>(items: readonly T[], u: number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = u * total;
  for (const item of items) {
    x -= item.weight;
    if (x < 0) return item;
  }
  return items[items.length - 1];
}
