import { api } from './api';
import type { Currency } from './passes';

export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'refunded';

export interface AdminPayment {
  id: string;
  userId: string;
  email: string;
  passId: string;
  days: number;
  /** Minor units: paise or cents, see `paymentCurrency`. */
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

/** Dodo rows end their note with the currency (`SR-A1B2C3-p30-USD`); every older row is rupees. */
export function paymentCurrency(p: Pick<AdminPayment, 'provider' | 'note'>): Currency {
  if (p.provider !== 'dodo') return 'INR';
  return /-USD$/.test(p.note) ? 'USD' : 'INR';
}

const PROVIDER_LABEL: Record<string, string> = {
  dodo: 'Dodo Payments',
  upi: 'UPI (old)',
  instamojo: 'Instamojo',
};

export const providerLabel = (provider: string): string => PROVIDER_LABEL[provider] ?? provider;

const STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pending',
  approved: 'Paid',
  rejected: 'Rejected',
  failed: 'Failed',
  refunded: 'Refunded',
};

export const statusLabel = (status: PaymentStatus): string => STATUS_LABEL[status];
