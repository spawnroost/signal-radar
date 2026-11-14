import { useState } from 'react';
import { formatPrice, PASSES, type Currency, type Pass } from '@radar/core/passes';
import { createOrder, loadCheckout, openCheckout, verifyPayment } from '../lib/billing';
import { showGate, setGateNext } from '../lib/gate';
import { refreshMe, type MeState } from '../lib/me';
import { usePaymentsOpen } from '../lib/payments';
import { CheckIcon, RadarArcs } from '../icons';
import { formatDate } from '../lib/plan';
import {
  CURRENCY_SYMBOL,
  INTERNATIONAL_PAYMENTS,
  durationLabel,
  perMonth,
  savingsPercent,
  storeCurrency,
  storedCurrency,
} from '../lib/passes';
import { COMPARE, PRICE } from '../lib/tiers';
import { Link } from './Link';

/** Razorpay's checkout is a light page, so it gets the app's light-theme ink for its buttons. */
const CHECKOUT_INK = '#26251e';

export function Pricing({ me }: { me: MeState }) {
  // INR unless the build offers USD and the visitor picked it earlier; the server agrees.
  const [currency, setCurrency] = useState<Currency>(() => storedCurrency());
  /** Null until the server has said whether Razorpay keys are set (or when it could not). */
  const enabled = usePaymentsOpen();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [paidUntil, setPaidUntil] = useState('');

  const buy = async (pass: Pass) => {
    if (me.status !== 'ready') {
      setGateNext('/pricing');
      showGate('pro');
      return;
    }
    if (enabled !== true || busy !== null) return;
    setBusy(pass.id);
    setError('');
    setPaidUntil('');
    try {
      await loadCheckout();
      const order = await createOrder(pass.id, currency);
      openCheckout({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: order.name,
        description: `${durationLabel(pass.days)} of Pro`,
        order_id: order.orderId,
        prefill: { email: order.email },
        theme: { color: CHECKOUT_INK },
        modal: { ondismiss: () => setBusy(null) },
        handler: (signature) => {
          verifyPayment(signature)
            .then(async (res) => {
              setPaidUntil(res.currentPeriodEnd);
              await refreshMe();
            })
            .catch(() =>
              setError(
                'Payment went through but we could not confirm it; reload the page in a moment.',
              ),
            )
            .finally(() => setBusy(null));
        },
      });
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : 'Could not start payment. Try again.');
    }
  };

  const until = paidUntil || (me.status === 'ready' ? me.me.proUntil : '');
  const other: Currency = currency === 'INR' ? 'USD' : 'INR';

  return (
    <section className="pricing" aria-labelledby="pricing-title">
      <header className="pricing-hero">
        <RadarArcs className="pricing-arcs" />
        <h2 id="pricing-title" className="page-title page-title-lg">
          Skip the blank page.
        </h2>
        <p className="pricing-pitch">
          Pro drafts a hook, an angle and a title for every story you queue, so you open the radar
          and start from something. Pay once. No subscription: a pass is a block of days, and buying
          again adds more.
        </p>
      </header>

      {enabled === false && (
        <div className="pricing-soon" role="status">
          <span className="pricing-soon-dot" aria-hidden="true" />
          <p>
            <strong>Pro opens soon.</strong> Payments open shortly, and Free works fully now.{' '}
            <Link to="read" className="link">
              Open the radar
            </Link>
          </p>
        </div>
      )}

      <ul className="passes">
        {PASSES.map((pass) => {
          const best = pass.id === 'p365';
          const amount = currency === 'INR' ? pass.inr : pass.usd;
          const saves = savingsPercent(pass, currency);
          const length = durationLabel(pass.days);
          return (
            <li key={pass.id} className="pass" data-best={best || undefined}>
              {best && <RadarArcs className="pass-arcs" />}
              <div className="pass-head">
                <h3 className="pass-title">{length}</h3>
                {best && <span className="pass-flag">Best value</span>}
              </div>
              <p className="pass-price">
                <span className="price">{formatPrice(pass, currency)}</span>
              </p>
              <p className="pass-month">{perMonth(amount, pass.days, currency)}</p>
              <p className="pass-save">
                {saves > 0 ? `Saves ${saves}% against 30-day passes` : 'A month to try it properly'}
              </p>
              <button
                type="button"
                className={best ? 'btn btn-solid' : 'btn'}
                aria-label={
                  enabled === false ? `${length} of Pro, coming soon` : `Buy ${length} of Pro`
                }
                disabled={enabled !== true || busy !== null}
                onClick={() => void buy(pass)}
              >
                {enabled === false ? 'Coming soon' : busy === pass.id ? 'One moment' : 'Buy'}
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="warn pass-status" role="alert">
          {error}
        </p>
      )}
      {until && (
        <p className="pass-status" role="status">
          You’re Pro until {formatDate(until)}.
        </p>
      )}
      {INTERNATIONAL_PAYMENTS && (
        <button
          type="button"
          className="text-btn pass-currency"
          onClick={() => {
            storeCurrency(other);
            setCurrency(other);
          }}
        >
          Prices in {CURRENCY_SYMBOL[currency]} · Show in {CURRENCY_SYMBOL[other]}
        </button>
      )}

      <section className="compare" aria-labelledby="pricing-compare">
        <h2 id="pricing-compare" className="pricing-h">
          Free and Pro, side by side
        </h2>
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">What you get</span>
              </th>
              <th scope="col">
                Free
                <span className="compare-price">{PRICE.free}</span>
              </th>
              <th scope="col">
                Pro
                <span className="compare-price">from {PRICE.pro}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <CompareCell value={row.free} />
                <CompareCell value={row.pro} />
              </tr>
            ))}
          </tbody>
        </table>
        {me.status !== 'ready' && (
          <p className="meta compare-note">New accounts get 7 days of Pro free.</p>
        )}
      </section>

      <section className="faq" aria-labelledby="pricing-faq">
        <h2 id="pricing-faq" className="pricing-h">
          Before you pay
        </h2>
        <dl>
          <div>
            <dt>Is this a subscription?</dt>
            <dd>No. You pay once for a block of days. Nothing renews and no card is kept.</dd>
          </div>
          <div>
            <dt>What if I buy again?</dt>
            <dd>The days add up. A second pass starts where the first one ends.</dd>
          </div>
          <div>
            <dt>What happens when Pro ends?</dt>
            <dd>
              You go back to Free. Your account and saved links stay, and your own feeds pause until
              you buy again.
            </dd>
          </div>
          <div>
            <dt>Can I get a refund?</dt>
            <dd>
              Yes, within 7 days. See the{' '}
              <Link to="refunds" className="link">
                refund policy
              </Link>{' '}
              and the{' '}
              <Link to="terms" className="link">
                terms
              </Link>
              .
            </dd>
          </div>
          <div>
            <dt>How do I pay?</dt>
            <dd>Razorpay takes UPI, cards and netbanking. Your statement shows SAMBIT NAYAK.</dd>
          </div>
        </dl>
      </section>
    </section>
  );
}

function CompareCell({ value }: { value: string | boolean }) {
  if (typeof value === 'string') return <td>{value}</td>;
  return (
    <td>
      {value ? (
        <>
          <span className="compare-yes">
            <CheckIcon />
          </span>
          <span className="sr-only">Included</span>
        </>
      ) : (
        <>
          <span className="compare-no" aria-hidden="true" />
          <span className="sr-only">Not included</span>
        </>
      )}
    </td>
  );
}
