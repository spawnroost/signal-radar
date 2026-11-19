import { useEffect, useState } from 'react';
import { setGateNext } from '../lib/gate';
import { refreshMe, type MeState } from '../lib/me';
import { formatDate } from '../lib/plan';
import { useSearchString } from '../lib/route';
import {
  fetchPaymentStatus,
  POLL_LIMIT_MS,
  POLL_MS,
  returnView,
  type PaymentState,
} from '../lib/checkout';
import { Link } from './Link';
import { PageSkeleton } from './Skeletons';

/** Where Dodo sends the buyer back: `/billing/return?ref=<payment id>`. Waits for the webhook to grant Pro. */
export function BillingReturn({ me }: { me: MeState }) {
  const ref = new URLSearchParams(useSearchString()).get('ref');
  const ready = me.status === 'ready';
  const [state, setState] = useState<PaymentState | null>(null);
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    if (!ready || !ref) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      let latest: PaymentState | null = null;
      try {
        latest = await fetchPaymentStatus(ref);
      } catch {
        /* a failed check is retried on the next tick */
      }
      if (stop) return;
      const elapsed = Date.now() - started;
      if (latest) setState(latest);
      setWaited(elapsed);
      const done = latest !== null && latest.status !== 'pending';
      if (latest?.status === 'approved') void refreshMe();
      if (!done && elapsed < POLL_LIMIT_MS) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [ready, ref]);

  if (me.status === 'loading') {
    return (
      <div className="state" aria-busy="true">
        <PageSkeleton />
      </div>
    );
  }
  if (me.status === 'error') {
    return (
      <div className="state" role="alert">
        <h2 className="state-title">Could not check your session</h2>
        <p>The server did not answer. Reload the page to try again.</p>
        <p className="meta">{me.message}</p>
      </div>
    );
  }
  if (me.status === 'anon') {
    return (
      <div className="state">
        <h2 className="state-title">Sign in to see your payment</h2>
        <p>Sign in with the account you paid from, and your Pro days will show.</p>
        <div className="auth-actions">
          <Link
            to="signin"
            className="btn btn-solid"
            onClick={() => setGateNext(location.pathname + location.search)}
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }
  if (!ref) {
    return (
      <div className="state">
        <h2 className="state-title">No payment to show</h2>
        <p>This page opens after a payment. You can pick a pass from the pricing page.</p>
        <div className="auth-actions">
          <Link to="pricing" className="btn btn-solid">
            See the passes
          </Link>
        </div>
      </div>
    );
  }

  const view = returnView(state?.status ?? null, waited);
  if (view === 'paid') {
    const until = formatDate(state?.currentPeriodEnd ?? null);
    return (
      <div className="state" role="status">
        <h2 className="state-title">{until ? `You're Pro until ${until}` : "You're Pro"}</h2>
        <p>Thanks. Your days have been added.</p>
        <div className="auth-actions">
          <Link to="read" className="btn btn-solid">
            Open the radar
          </Link>
        </div>
      </div>
    );
  }
  if (view === 'failed' || view === 'refunded') {
    return (
      <div className="state" role="status">
        <h2 className="state-title">
          {view === 'refunded' ? 'This payment was refunded' : 'The payment did not go through'}
        </h2>
        <p>
          {view === 'refunded'
            ? 'It was returned to you, so there is nothing more to do.'
            : 'No pass was added to your account. You can try again.'}
        </p>
        <div className="auth-actions">
          <Link to="pricing" className="btn btn-solid">
            Try again
          </Link>
        </div>
      </div>
    );
  }
  if (view === 'timeout') {
    return (
      <div className="state" role="status">
        <h2 className="state-title">Still confirming your payment</h2>
        <p>Payment is being confirmed. Pro turns on as soon as Dodo confirms it.</p>
        <div className="auth-actions">
          <Link to="read" className="btn btn-solid">
            Open the radar
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="state" role="status" aria-busy="true">
      <h2 className="state-title">Confirming your payment</h2>
      <p>This usually takes a few seconds.</p>
    </div>
  );
}
