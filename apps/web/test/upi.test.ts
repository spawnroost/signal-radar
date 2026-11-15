import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { checkUtr, hasPending, submitError } from '../src/lib/upi';

describe('checkUtr', () => {
  it('accepts a pasted reference with spaces', () => {
    expect(checkUtr('4012 3456 7890')).toEqual({ ok: true, utr: '401234567890' });
    expect(checkUtr(' 401234567890\n')).toEqual({ ok: true, utr: '401234567890' });
  });

  it('refuses anything that is not 12 digits', () => {
    for (const raw of ['', '12345678901', '1234567890123', 'abc123456789', '4012-3456-7890']) {
      expect(checkUtr(raw).ok).toBe(false);
    }
  });
});

describe('submitError', () => {
  it('words a duplicate calmly', () => {
    expect(submitError(new ApiError(409, 'That UTR was already used'))).toBe(
      'That reference was already used.',
    );
  });

  it('passes the server message through for other refusals', () => {
    expect(submitError(new ApiError(429, 'Too many attempts. Wait a moment and try again.'))).toBe(
      'Too many attempts. Wait a moment and try again.',
    );
    expect(submitError(new ApiError(400, 'UTR must be 12 digits'))).toBe('UTR must be 12 digits');
  });

  it('has a fallback for a non-API failure', () => {
    expect(submitError(new Error('boom'))).toBe('Could not send it. Try again.');
  });
});

describe('hasPending', () => {
  it('is true only while a payment is waiting', () => {
    expect(hasPending([{ status: 'approved' }, { status: 'rejected' }])).toBe(false);
    expect(hasPending([{ status: 'approved' }, { status: 'pending' }])).toBe(true);
    expect(hasPending([])).toBe(false);
  });
});
