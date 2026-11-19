/** Prepaid Pro passes: pay once for a block of Pro time. Prices are fixed per currency. */

export type PassId = 'p30' | 'p90' | 'p365';
export type Currency = 'INR' | 'USD';

export interface Pass {
  id: PassId;
  days: number;
  /** Indian price in paise. */
  inr: number;
  /** Price elsewhere in US cents. */
  usd: number;
}

export const PASSES: readonly Pass[] = [
  { id: 'p30', days: 30, inr: 14900, usd: 300 },
  { id: 'p90', days: 90, inr: 34900, usd: 700 },
  { id: 'p365', days: 365, inr: 99900, usd: 1900 },
];

const DAY_MS = 86_400_000;

/** ₹149 / $3; amounts are in paise/cents and prices are always whole units. */
export function formatPrice(pass: Pass, currency: Currency): string {
  const amount = currency === 'INR' ? pass.inr : pass.usd;
  return currency === 'INR' ? `₹${amount / 100}` : `$${amount / 100}`;
}

/** Adds pass days to the end of the current Pro time, or from now if it has lapsed. */
export function extendUntil(currentEnd: Date | null, now: Date, days: number): Date {
  const base = currentEnd && currentEnd > now ? currentEnd : now;
  return new Date(base.getTime() + days * DAY_MS);
}

/** First 6 characters of the user id, alphanumerics only, uppercased. Goes into payment notes. */
export function shortUserId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase();
}
