import { useEffect } from 'react';
import { normalizeUtr, UTR_LENGTH } from '@radar/core/upi';
import { api, ApiError } from './api';
import { createStore } from './store';

export interface UpiLink {
  /** The upi://pay link; opens the payer's UPI app on a phone. */
  link: string;
  vpa: string;
  name: string;
  /** Rupees. */
  amount: number;
  days: number;
  note: string;
}

export function fetchUpiLink(passId: string): Promise<UpiLink> {
  return api<UpiLink>(`/api/upi/link?passId=${encodeURIComponent(passId)}`);
}

export function submitUtr(passId: string, utr: string): Promise<{ id: string; status: string }> {
  return api('/api/upi/submit', { method: 'POST', json: { passId, utr } });
}

export interface MyPayment {
  id: string;
  passId: string;
  days: number;
  /** Paise. */
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
}

export function fetchMyPayments(): Promise<{ payments: MyPayment[] }> {
  return api<{ payments: MyPayment[] }>('/api/upi/mine');
}

export const UTR_HINT = `${UTR_LENGTH} digits`;

/** A pasted UTR may carry spaces; it must come to exactly 12 digits. */
export function checkUtr(raw: string): { ok: true; utr: string } | { ok: false; error: string } {
  const utr = normalizeUtr(raw);
  return utr ? { ok: true, utr } : { ok: false, error: `The reference is ${UTR_LENGTH} digits.` };
}

/** What the sheet says when the server refuses a UTR. */
export function submitError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return 'That reference was already used.';
    return e.message;
  }
  return 'Could not send it. Try again.';
}

export function hasPending(payments: readonly Pick<MyPayment, 'status'>[]): boolean {
  return payments.some((p) => p.status === 'pending');
}

/** Whether the signed-in user has a payment waiting for approval. */
const pending = createStore(false);

export function refreshPending(): Promise<void> {
  return fetchMyPayments()
    .then((res) => pending.set(hasPending(res.payments)))
    .catch(() => {
      /* a quiet extra line; leave it as it was */
    });
}

/** The shared answer, fetched once per mount while signed in. */
export function usePendingPayment(signedIn: boolean): boolean {
  useEffect(() => {
    if (signedIn) void refreshPending();
    else pending.set(false);
  }, [signedIn]);
  return pending.use();
}

export type PaymentStatus = MyPayment['status'];

export interface AdminPayment {
  id: string;
  userId: string;
  email: string;
  passId: string;
  days: number;
  /** Paise. */
  amount: number;
  provider: string;
  utr: string | null;
  note: string;
  status: PaymentStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export function fetchAdminPayments(
  status: PaymentStatus | 'all',
): Promise<{ payments: AdminPayment[] }> {
  return api<{ payments: AdminPayment[] }>(`/api/admin/payments?status=${status}`);
}

export function decidePayment(
  id: string,
  decision: 'approve' | 'reject',
): Promise<{ id: string; status: PaymentStatus }> {
  return api(`/api/admin/payments/${encodeURIComponent(id)}/${decision}`, { method: 'POST' });
}

/** What the admin page says when a decision fails. A 409 means it was decided somewhere else. */
export function decideError(e: unknown): string {
  if (e instanceof ApiError) {
    return e.status === 409 ? 'Already decided. The list has been refreshed.' : e.message;
  }
  return 'Could not reach the server. Try again.';
}
