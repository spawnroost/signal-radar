import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { checkoutError, POLL_LIMIT_MS, returnView, safeCheckoutUrl } from '../src/lib/checkout';

describe('checkoutError', () => {
  it('keeps the server wording for ordinary failures', () => {
    expect(checkoutError(new ApiError(429, 'Try again in an hour.'))).toBe('Try again in an hour.');
    expect(checkoutError(new ApiError(502, "Couldn't start the payment."))).toBe(
      "Couldn't start the payment.",
    );
  });

  it('words the network, sign-in and not-set-up cases', () => {
    expect(checkoutError(new ApiError(0, 'x'))).toMatch(/reach the server/);
    expect(checkoutError(new ApiError(401, 'x'))).toMatch(/Sign in/);
    expect(checkoutError(new ApiError(503, "Payments aren't set up"))).toMatch(/not open yet/);
    expect(checkoutError(new Error('boom'))).toMatch(/Could not start/);
  });
});

describe('safeCheckoutUrl', () => {
  it('follows only https addresses', () => {
    expect(safeCheckoutUrl('https://checkout.dodopayments.com/buy/abc')).toBe(
      'https://checkout.dodopayments.com/buy/abc',
    );
    expect(safeCheckoutUrl('http://example.com')).toBeNull();
    expect(safeCheckoutUrl('javascript:alert(1)')).toBeNull();
    expect(safeCheckoutUrl('not a url')).toBeNull();
    expect(safeCheckoutUrl(undefined)).toBeNull();
  });
});

describe('returnView', () => {
  it('shows the outcome as soon as it is known', () => {
    expect(returnView('approved', 0)).toBe('paid');
    expect(returnView('failed', 0)).toBe('failed');
    expect(returnView('rejected', 0)).toBe('failed');
    expect(returnView('refunded', 0)).toBe('refunded');
  });

  it('keeps checking until the wait runs out, then says it is still confirming', () => {
    expect(returnView(null, 0)).toBe('checking');
    expect(returnView('pending', POLL_LIMIT_MS - 1)).toBe('checking');
    expect(returnView('pending', POLL_LIMIT_MS)).toBe('timeout');
    expect(returnView(null, POLL_LIMIT_MS)).toBe('timeout');
  });
});
