import { describe, expect, it } from 'vitest';
import { paymentCurrency, providerLabel, statusLabel } from '../src/lib/adminPayments';

describe('paymentCurrency', () => {
  it('reads the currency from a Dodo note', () => {
    expect(paymentCurrency({ provider: 'dodo', note: 'SR-A1B2C3-p30-USD' })).toBe('USD');
    expect(paymentCurrency({ provider: 'dodo', note: 'SR-A1B2C3-p30-INR' })).toBe('INR');
  });

  it('treats every other provider as rupees', () => {
    expect(paymentCurrency({ provider: 'upi', note: 'SR-A1B2C3-p30' })).toBe('INR');
    expect(paymentCurrency({ provider: 'upi', note: 'SR-A1B2C3-p30-USD' })).toBe('INR');
  });
});

describe('labels', () => {
  it('names providers and statuses, and falls back to the raw provider', () => {
    expect(providerLabel('dodo')).toBe('Dodo Payments');
    expect(providerLabel('other')).toBe('other');
    expect(statusLabel('approved')).toBe('Paid');
    expect(statusLabel('refunded')).toBe('Refunded');
  });
});
