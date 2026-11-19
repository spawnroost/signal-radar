import { describe, expect, it } from 'vitest';
import { PASSES, extendUntil, formatPrice, shortUserId } from '../src/passes.js';

const NOW = new Date('2026-11-09T06:00:00Z');
const pass = (id: string) => PASSES.find((p) => p.id === id)!;

describe('PASSES', () => {
  it('has the three passes with days and prices in minor units', () => {
    expect(PASSES.map((p) => ({ id: p.id, days: p.days, inr: p.inr, usd: p.usd }))).toEqual([
      { id: 'p30', days: 30, inr: 14900, usd: 300 },
      { id: 'p90', days: 90, inr: 34900, usd: 700 },
      { id: 'p365', days: 365, inr: 99900, usd: 1900 },
    ]);
  });
});

describe('formatPrice', () => {
  it('prints rupees and dollars without decimals', () => {
    expect(formatPrice(pass('p30'), 'INR')).toBe('₹149');
    expect(formatPrice(pass('p90'), 'INR')).toBe('₹349');
    expect(formatPrice(pass('p365'), 'INR')).toBe('₹999');
    expect(formatPrice(pass('p30'), 'USD')).toBe('$3');
    expect(formatPrice(pass('p90'), 'USD')).toBe('$7');
    expect(formatPrice(pass('p365'), 'USD')).toBe('$19');
  });
});

describe('extendUntil', () => {
  it('adds days from now when there is no current Pro time', () => {
    expect(extendUntil(null, NOW, 30)).toEqual(new Date('2026-12-09T06:00:00Z'));
  });

  it('adds days from now when the current Pro time has lapsed', () => {
    const past = new Date('2026-10-01T00:00:00Z');
    expect(extendUntil(past, NOW, 90)).toEqual(new Date('2027-02-07T06:00:00Z'));
  });

  it('adds days to the end of the current Pro time when it is still running', () => {
    const end = new Date('2026-12-01T00:00:00Z');
    expect(extendUntil(end, NOW, 365)).toEqual(new Date('2027-12-01T00:00:00Z'));
  });

  it('does not mutate its inputs', () => {
    const end = new Date('2026-12-01T00:00:00Z');
    const copy = new Date(end);
    extendUntil(end, NOW, 30);
    expect(end).toEqual(copy);
  });
});

describe('shortUserId', () => {
  it('uses the first 6 alphanumerics uppercased', () => {
    expect(shortUserId('a1b2-c3d4e5')).toBe('A1B2C3');
    expect(shortUserId('--ab')).toBe('AB');
  });
});
