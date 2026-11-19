import { useCallback, useEffect, useState } from 'react';
import type { MeState } from '../lib/me';
import { formatAge } from '../lib/format';
import { durationLabel, formatMoney } from '../lib/passes';
import {
  fetchAdminPayments,
  paymentCurrency,
  providerLabel,
  statusLabel,
  type AdminPayment,
  type PaymentStatus,
} from '../lib/adminPayments';
import { Link } from './Link';
import { Tabs } from './Tabs';

type Filter = PaymentStatus | 'all';

const STATUSES: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Paid' },
  { id: 'failed', label: 'Failed' },
  { id: 'refunded', label: 'Refunded' },
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
  const [status, setStatus] = useState<Filter>('all');
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
        onChange={(id) => setStatus(id as Filter)}
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
              {status === 'all'
                ? 'No payments yet.'
                : `No ${statusLabel(status).toLowerCase()} payments.`}
            </p>
          ) : (
            <ul className="admin-list">
              {load.payments.map((p) => (
                <Row key={p.id} p={p} />
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}

function Row({ p }: { p: AdminPayment }) {
  const price = formatMoney(p.amount, paymentCurrency(p));
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
        </div>
      )}
      <p className="meta admin-note">{p.note}</p>
      <p className="meta">
        {statusLabel(p.status)} via {providerLabel(p.provider)}
        {p.decidedAt && `, ${formatAge(p.decidedAt)} ago`}
      </p>
    </li>
  );
}
