import { fetchPasses } from './billing';
import { createStore } from './store';
import { useEffect } from 'react';

/**
 * Whether the server takes payments (`enabled` on /api/billing/passes). Null until it has said so,
 * or when it could not be asked; callers treat null as "carry on as before".
 */
const open = createStore<boolean | null>(null);
let asked = false;

export function setPaymentsOpen(value: boolean): void {
  asked = true;
  open.set(value);
}

/** The shared answer; the first component to use it triggers the one request. */
export function usePaymentsOpen(): boolean | null {
  useEffect(() => {
    if (asked) return;
    asked = true;
    fetchPasses()
      .then((info) => open.set(info.enabled))
      .catch(() => {
        asked = false; // a later mount may try again
      });
  }, []);
  return open.use();
}

/** The words that replace an upgrade link while payments are closed. */
export const PRO_SOON = 'Pro is coming soon';
