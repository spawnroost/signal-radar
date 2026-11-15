import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import type { MeState } from '../lib/me';
import { formatAge } from '../lib/format';
import { durationLabel, formatMoney } from '../lib/passes';
import {
  decideError,
  decidePayment,
  fetchAdminPayments,
  type AdminPayment,
  type PaymentStatus,
} from '../lib/upi';
import { Link } from './Link';
import { Tabs } from './Tabs';

const STATUSES: { id: PaymentStatus; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; payments: AdminPayment[] };

/** Admin only. Anyone else, signed in or not, sees what an unknown address shows. */
export function AdminPayments({ me }: { me: MeState }) {
  if (me.status === 'loading') return <div aria-busy="true" className="admin-wait" />;
  if (me.status !== 'ready' || !me.me.isAdmin) return <NotFound />;
  return <Payments />;
}

function NotFound() {
  return (
    <div className="state">
      <h2 className="state-title">Page not found</h2>
      <p>
        There is nothing at this address.{' '}
        <Link to="read" className="link">
          Back to the radar
        </Link>
        .
      </p>
    </div>
  );
}

function Payments() {
  const [status, setStatus] = useState<PaymentStatus>('pending');
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    fetchAdminPayments(status)
      .then((res) => live && setLoad({ status: 'ready', payments: res.payments }))
      .catch((e: unknown) => {
        if (live) {
          setLoad({
            status: 'error',
            message: e instanceof Error ? e.message : 'Could not load the payments.',
          });
        }
      });
    return () => {
      live = false;
    };
  }, [status, attempt]);

  return (
    <section aria-labelledby="admin-title">
      <div className="page-head">
        <h2 id="admin-title" className="page-title">
          Payments
        </h2>
      </div>
      <Tabs
        tabs={STATUSES}
        active={status}
        onChange={(id) => setStatus(id as PaymentStatus)}
        label="Payment status"
        panelId="admin-panel"
        idPrefix="admin-status"
      />
      <div
        id="admin-panel"
        role="tabpanel"
        aria-labelledby={`admin-status-${status}`}
        className="admin-panel"
      >
        {load.status === 'loading' && (
          <p className="meta" role="status">
            Loading
          </p>
        )}
        {load.status === 'error' && (
          <div className="state" role="alert">
            <h2 className="state-title">The list did not load</h2>
            <p>
              <button type="button" className="link" onClick={refresh}>
                Try again
              </button>
            </p>
            <p className="meta">{load.message}</p>
          </div>
        )}
        {load.status === 'ready' &&
          (load.payments.length === 0 ? (
            <p className="meta admin-empty">
              {status === 'pending' ? 'Nothing waiting for approval.' : `No ${status} payments.`}
            </p>
          ) : (
            <ul className="admin-list">
              {load.payments.map((p) => (
                <Row key={p.id} p={p} onDecided={refresh} />
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}

function Row({ p, onDecided }: { p: AdminPayment; onDecided: () => void }) {
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const price = formatMoney(p.amount, 'INR');

  const copy = () => {
    if (!p.utr) return;
    navigator.clipboard
      .writeText(p.utr)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* no clipboard: the UTR is selectable */
      });
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await decidePayment(p.id, decision);
      onDecided();
    } catch (e) {
      setError(decideError(e));
      // a 409 means someone else decided it first: the list is stale
      if (e instanceof ApiError && e.status === 409) onDecided();
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <li className="admin-row">
      <div className="admin-top">
        <span className="admin-email">{p.email}</span>
        <span className="meta">{formatAge(p.createdAt)}</span>
      </div>
      <p className="admin-what">
        {durationLabel(p.days)} <span className="meta">({p.passId})</span>
        <span className="admin-price">{price}</span>
      </p>
      {p.utr && (
        <div className="admin-utr">
          <span className="admin-utr-id">{p.utr}</span>
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      <p className="meta admin-note">{p.note}</p>

      {p.status === 'pending' ? (
        confirm ? (
          <div className="admin-confirm">
            <p className="admin-confirm-text" role="status">
              {confirm === 'approve'
                ? `Check that ${price} has reached your UPI app, with this UTR, before approving.`
                : 'Reject this payment? The user is told it could not be verified.'}
            </p>
            <div className="admin-actions">
              <button
                type="button"
                className="btn btn-solid"
                disabled={busy}
                onClick={() => void decide(confirm)}
              >
                {confirm === 'approve' ? 'Yes, approve' : 'Yes, reject'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="admin-actions">
            <button type="button" className="btn btn-solid" onClick={() => setConfirm('approve')}>
              Approve
            </button>
            <button type="button" className="btn" onClick={() => setConfirm('reject')}>
              Reject
            </button>
          </div>
        )
      ) : (
        <p className="meta">
          {p.status === 'approved' ? 'Approved' : 'Rejected'}
          {p.decidedAt && ` ${formatAge(p.decidedAt)} ago`}
          {p.decidedBy && ` by ${p.decidedBy.startsWith('telegram:') ? 'Telegram' : 'admin'}`}
        </p>
      )}
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
