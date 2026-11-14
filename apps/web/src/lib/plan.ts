import type { Me, Subscription } from './me';

export interface PlanSummary {
  kind: 'free' | 'trial' | 'active' | 'canceled';
  title: string;
  detail: string;
  canUpgrade: boolean;
  canCancel: boolean;
}

const DAY = 86_400_000;

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** What the Plan section of Settings says, derived from the subscription row. */
export function planSummary(sub: Subscription, now = Date.now()): PlanSummary {
  if (sub.status === 'trialing' && sub.isPro) {
    const end = sub.trialEndsAt ? Date.parse(sub.trialEndsAt) : NaN;
    const days = Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - now) / DAY));
    return {
      kind: 'trial',
      title: 'Pro trial',
      detail:
        days === null
          ? 'Your trial is running.'
          : `Ends ${formatDate(sub.trialEndsAt)}, in ${days} ${days === 1 ? 'day' : 'days'}.`,
      canUpgrade: true,
      canCancel: false,
    };
  }
  if (sub.status === 'active') {
    return {
      kind: 'active',
      title: 'Pro',
      detail: sub.currentPeriodEnd ? `Pro until ${formatDate(sub.currentPeriodEnd)}.` : '',
      canUpgrade: false,
      canCancel: false,
    };
  }
  if (sub.status === 'canceled' && sub.isPro) {
    return {
      kind: 'canceled',
      title: 'Pro, canceled',
      detail: sub.currentPeriodEnd
        ? `You keep Pro until ${formatDate(sub.currentPeriodEnd)}.`
        : 'You keep Pro for now.',
      canUpgrade: true,
      canCancel: false,
    };
  }
  return {
    kind: 'free',
    title: 'Free',
    detail:
      sub.status === 'none'
        ? 'The Read view, an Ideas queue and 3 page summaries a day.'
        : 'Your Pro access has ended. Ideas and 3 summaries a day stay.',
    canUpgrade: true,
    canCancel: false,
  };
}

export interface PlanBadge {
  /** "Pro" or "Free". */
  name: 'Pro' | 'Free';
  /** The quiet part after the name: "trial, 5 days left", "until 12 Mar 2027", or ''. */
  note: string;
  /** Days left on a trial, else null. */
  trialDays: number | null;
  /** Pro with no end date (granted by hand, or the end is unknown). */
  open: boolean;
}

/** One line for the account menu, Settings and Pricing: what plan the user is on and until when. */
export function planBadge(me: Pick<Me, 'subscription' | 'proUntil'>, now = Date.now()): PlanBadge {
  const sub = me.subscription;
  if (!sub.isPro) return { name: 'Free', note: '', trialDays: null, open: false };
  const end = me.proUntil ?? (sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd);
  const t = end ? Date.parse(end) : NaN;
  const days = Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / DAY));
  if (sub.status === 'trialing') {
    const left =
      days === null
        ? ''
        : days === 0
          ? ', ends today'
          : `, ${days} ${days === 1 ? 'day' : 'days'} left`;
    return { name: 'Pro', note: `trial${left}`, trialDays: days, open: false };
  }
  const date = formatDate(end);
  return { name: 'Pro', note: date ? `until ${date}` : '', trialDays: null, open: !date };
}
