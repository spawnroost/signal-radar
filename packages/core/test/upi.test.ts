import { describe, expect, it } from 'vitest';
import {
  isValidUpiId,
  isValidUtr,
  normalizeUtr,
  rupees,
  shortUserId,
  upiNote,
  upiPayLink,
} from '../src/index.js';

describe('normalizeUtr', () => {
  it('strips spaces from a pasted UTR', () => {
    expect(normalizeUtr(' 1234 5678 9012 ')).toBe('123456789012');
    expect(normalizeUtr('123456789012')).toBe('123456789012');
  });

  it('refuses anything that is not 12 digits', () => {
    expect(normalizeUtr('12345678901')).toBe('');
    expect(normalizeUtr('1234567890123')).toBe('');
    expect(normalizeUtr('12345678901a')).toBe('');
    expect(normalizeUtr('1234-5678-9012')).toBe('');
    expect(normalizeUtr('')).toBe('');
  });

  it('isValidUtr checks the normalised form', () => {
    expect(isValidUtr('123456789012')).toBe(true);
    expect(isValidUtr('12345678901')).toBe(false);
    expect(isValidUtr('1234 5678 9012')).toBe(false);
  });
});

describe('isValidUpiId', () => {
  it('accepts handle@provider and rejects the rest', () => {
    expect(isValidUpiId('name@okbank')).toBe(true);
    expect(isValidUpiId('first.last-1@ybl')).toBe(true);
    expect(isValidUpiId('name')).toBe(false);
    expect(isValidUpiId('@bank')).toBe(false);
    expect(isValidUpiId('a b@bank')).toBe(false);
  });
});

describe('upiPayLink', () => {
  it('builds the exact link and formats the amount as rupees', () => {
    expect(
      upiPayLink({
        vpa: 'name@bank',
        name: 'Signal Radar',
        amountPaise: 9900,
        note: 'SR-A1B2C3-p30',
      }),
    ).toBe('upi://pay?pa=name%40bank&pn=Signal%20Radar&am=99.00&cu=INR&tn=SR-A1B2C3-p30');
  });

  it('encodes @ and spaces and leaves no raw space', () => {
    const link = upiPayLink({ vpa: 'a.b@ybl', name: 'A & B', amountPaise: 79900, note: 'x y' });
    expect(link).toContain('pa=a.b%40ybl');
    expect(link).toContain('pn=A%20%26%20B');
    expect(link).toContain('tn=x%20y');
    expect(link).toContain('am=799.00');
    expect(link).not.toContain(' ');
  });

  it('rupees keeps two decimals', () => {
    expect(rupees(9900)).toBe('99.00');
    expect(rupees(24950)).toBe('249.50');
  });
});

describe('upiNote', () => {
  it('uses the first 6 alphanumerics uppercased', () => {
    expect(shortUserId('a1b2-c3d4e5')).toBe('A1B2C3');
    expect(upiNote('a1b2c3d4e5', 'p30')).toBe('SR-A1B2C3-p30');
    expect(upiNote('--ab', 'p365')).toBe('SR-AB-p365');
  });
});
