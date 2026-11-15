/** Direct UPI payments: UTR handling, the upi:// pay link and the transaction note. */

/** A UPI reference (UTR / RRN) is exactly 12 digits. Users often paste it with spaces. */
export const UTR_LENGTH = 12;
const UTR_RE = /^[0-9]{12}$/;

/** UPI ID (VPA) shape: handle@provider. It does not prove the ID exists. */
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

export const isValidUpiId = (id: string): boolean => UPI_RE.test(id.trim());

/** Strip whitespace from a pasted UTR. Returns "" unless the result is exactly 12 digits. */
export function normalizeUtr(raw: string): string {
  const digits = raw.replace(/\s+/g, '');
  return UTR_RE.test(digits) ? digits : '';
}

export const isValidUtr = (utr: string): boolean => UTR_RE.test(utr);

export interface UpiPayLink {
  /** Receiving UPI ID (VPA). */
  vpa: string;
  /** Payee name shown in the payer's UPI app. */
  name: string;
  /** Amount in paise; written into the link as plain decimal rupees. */
  amountPaise: number;
  /** Transaction note (`tn=`), e.g. SR-A1B2C3-p30. */
  note: string;
}

/** Paise as plain decimal rupees, always two places: 9900 -> "99.00". */
export function rupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** `upi://pay?pa=...&pn=...&am=...&cu=INR&tn=...` with every value URL-encoded. */
export function upiPayLink({ vpa, name, amountPaise, note }: UpiPayLink): string {
  const q = encodeURIComponent;
  return [
    `upi://pay?pa=${q(vpa)}`,
    `pn=${q(name)}`,
    `am=${rupees(amountPaise)}`,
    'cu=INR',
    `tn=${q(note)}`,
  ].join('&');
}

/** First 6 characters of the user id, alphanumerics only, uppercased. */
export function shortUserId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase();
}

/** Transaction note: `SR-<short user id>-<pass id>`. */
export function upiNote(userId: string, passId: string): string {
  return `SR-${shortUserId(userId)}-${passId}`;
}
