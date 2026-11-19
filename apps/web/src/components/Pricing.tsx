import { useState } from 'react';
import { formatPrice, PASSES, type Pass } from '@radar/core/passes';
import { showGate, setGateNext } from '../lib/gate';
import type { MeState } from '../lib/me';
import { usePaymentsOpen } from '../lib/payments';
import { CheckIcon, RadarArcs } from '../icons';
import { formatDate, planBadge } from '../lib/plan';
import { startCheckout } from '../lib/checkout';
import { durationLabel, perMonth, savingsPercent, storedCurrency } from '../lib/passes';
import { COMPARE, PRICE } from '../lib/tiers';
import { Link } from './Link';
import { PlanLine } from './PlanLine';

const HERO = {
  free: {
    title: 'Skip the blank page.',
    pitch:
      'Pro drafts a hook, an angle and a title for every story you queue, so you open the radar and start from something. Pay once. No subscription: a pass is a block of days, and buying again adds more.',
  },
  trial: {
    title: 'Keep Pro after your trial.',
    pitch:
      'A pass starts where the trial stops, so nothing lapses. Pay once. No subscription: a pass is a block of days, and buying again adds more.',
  },
  pro: {
    title: 'Add more days to Pro.',
    pitch:
      'A pass adds its days to the end of your Pro. Pay once. No subscription: nothing renews and no card is kept.',
  },
  open: {
    title: 'Nothing to buy.',
    pitch: 'Your Pro has no end date, so there are no days to add.',
  },
} as const;

function daysLeftText(days: number): string {
  return days === 0 ? 'ends today' : `${days} ${days === 1 ? 'day' : 'days'} left`;
}

export function Pricing({ me }: { me: MeState }) {
  /** Null until the server has said whether checkout is set up (or when it could not). */
  const enabled = usePaymentsOpen();
  const currency = storedCurrency();
  /** The pass whose checkout is being opened; every Buy button waits while one is. */
  const [paying, setPaying] = useState<Pass['id'] | null>(null);
  const [error, setError] = useState('');

  const buy = async (pass: Pass) => {
    if (me.status !== 'ready') {
      setGateNext('/pricing');
      showGate('pro');
      return;
    }
    if (enabled !== true || paying) return;
    setError('');
    setPaying(pass.id);
    try {
      await startCheckout(pass.id, currency);
      // The browser is on its way to the checkout page; the button stays busy until it leaves.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment. Try again.');
      setPaying(null);
    }
  };

  const badge = me.status === 'ready' ? planBadge(me.me) : null;
  const isPro = badge?.name === 'Pro';
  const trial = isPro && badge.trialDays !== null;
  /** Pro with no end date: nothing to buy. */
  const noEnd = isPro && badge.open;
  const statusText = !isPro
    ? ''
    : noEnd
      ? 'Pro, no end date'
      : `${trial ? 'Free trial ends' : 'Pro until'} ${formatDate(badge.until)}${
          badge.daysLeft === null ? '' : `, ${daysLeftText(badge.daysLeft)}`
        }`;
  const copy = HERO[noEnd ? 'open' : trial ? 'trial' : isPro ? 'pro' : 'free'];

  const compare = (
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
  );

  return (
    <section className="pricing" aria-labelledby="pricing-title">
      <header className="pricing-hero" data-pro={isPro || undefined}>
        <RadarArcs className="head-arcs" />
        {isPro && (
          <PlanLine name="Pro" role="status">
            {statusText}
          </PlanLine>
        )}
        <h2 id="pricing-title" className="page-title page-title-lg">
          {copy.title}
        </h2>
        <p className="pricing-pitch">{copy.pitch}</p>
        {noEnd && (
          <Link to="read" className="btn pricing-back">
            Open the radar
          </Link>
        )}
      </header>

      {enabled === false && !noEnd && (
        <div className="pricing-soon" role="status">
          <span className="pricing-soon-dot" aria-hidden="true" />
          <p>
            {isPro ? (
              <>
                <strong>Adding days opens soon.</strong> Payments open shortly. Your Pro runs as it
                is until then.
              </>
            ) : (
              <>
                <strong>Pro opens soon.</strong> Payments open shortly, and Free works fully now.{' '}
                <Link to="read" className="link">
                  Open the radar
                </Link>
              </>
            )}
          </p>
        </div>
      )}

      {!noEnd && (
        <ul className="passes">
          {PASSES.map((pass) => {
            const best = pass.id === 'p365';
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
                <p className="pass-month">
                  {perMonth(currency === 'INR' ? pass.inr : pass.usd, pass.days, currency)}
                </p>
                <p className="pass-save">
                  {saves > 0
                    ? `Saves ${saves}% against 30-day passes`
                    : 'A month to try it properly'}
                </p>
                <button
                  type="button"
                  className={best ? 'btn btn-solid' : 'btn'}
                  aria-label={
                    enabled === false
                      ? `${length} of Pro, coming soon`
                      : `${isPro ? 'Add' : 'Buy'} ${length} of Pro`
                  }
                  disabled={enabled !== true || paying !== null}
                  aria-busy={paying === pass.id || undefined}
                  onClick={() => void buy(pass)}
                >
                  {enabled === false
                    ? 'Coming soon'
                    : paying === pass.id
                      ? 'Opening'
                      : isPro && !trial
                        ? 'Add'
                        : 'Buy'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && !noEnd && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}

      {!isPro && compare}

      {!noEnd && (
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
                You go back to Free. Your account and saved links stay, and your own feeds pause
                until you buy again.
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
              <dd>
                Press Buy and you go to a secure checkout run by Dodo Payments, which shows the
                payment methods you can use. You come back here, and Pro turns on as soon as the
                payment is confirmed.
              </dd>
            </div>
          </dl>
        </section>
      )}

      {isPro && !noEnd && compare}
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
