import { api, ApiError } from './api';
import type { Currency, Pass } from './passes';

export type PaymentStatus = 'pending' | 'approved' | 'failed' | 'refunded' | 'rejected';

export interface PaymentState {
  status: PaymentStatus;
  currentPeriodEnd: string | null;
}

/** How often the return page asks, and how long it keeps asking before it stops. */
export const POLL_MS = 2000;
export const POLL_LIMIT_MS = 60_000;

/** A readable line for whatever went wrong starting a checkout. */
export function checkoutError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Could not reach the server. Check your connection and try again.';
    if (e.status === 401) return 'Sign in to buy a pass.';
    if (e.status === 503) return 'Payments are not open yet. Try again soon.';
    return e.message;
  }
  return 'Could not start the payment. Try again.';
}

/** Only an https address is followed: the reply is never trusted to send the page anywhere else. */
export function safeCheckoutUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Asks for a hosted checkout, then sends the browser there. Throws an Error with a readable message. */
export async function startCheckout(passId: Pass['id'], currency: Currency): Promise<void> {
  let url: string | null;
  try {
    const res = await api<{ checkoutUrl?: unknown }>('/api/billing/dodo/checkout', {
      method: 'POST',
      json: { passId, currency },
    });
    url = safeCheckoutUrl(res?.checkoutUrl);
  } catch (e) {
    throw new Error(checkoutError(e), { cause: e });
  }
  if (!url) throw new Error('Could not start the payment. Try again shortly.');
  location.assign(url);
}

export function fetchPaymentStatus(ref: string): Promise<PaymentState> {
  return api<PaymentState>(`/api/billing/dodo/status/${encodeURIComponent(ref)}`);
}

export type ReturnView = 'checking' | 'paid' | 'failed' | 'refunded' | 'timeout';

/** What the return page shows for the latest status and the time spent waiting. */
export function returnView(status: PaymentStatus | null, waitedMs: number): ReturnView {
  if (status === 'approved') return 'paid';
  if (status === 'refunded') return 'refunded';
  if (status === 'failed' || status === 'rejected') return 'failed';
  return waitedMs >= POLL_LIMIT_MS ? 'timeout' : 'checking';
}
