/** What Free and Pro include. The Pricing page and the landing page both render these. */
import { INTERNATIONAL_PAYMENTS } from './passes';
import { formatPrice, PASSES } from '@radar/core/passes';

const INTL = INTERNATIONAL_PAYMENTS;

const [first, second, third] = PASSES;
if (!first || !second || !third) throw new Error('PASSES needs three passes');

const inr = (pass: typeof first) => formatPrice(pass, 'INR');
const usd = (pass: typeof first) => formatPrice(pass, 'USD');
const length = (pass: typeof first) => (pass.days >= 365 ? 'a year' : `${pass.days} days`);
/** "₹149 for 30 days", or "₹149 or $3 for 30 days" when dollars are on. */
const priced = (pass: typeof first) =>
  `${INTL ? `${inr(pass)} or ${usd(pass)}` : inr(pass)} for ${length(pass)}`;

/** Prices in marketing copy: rupees only until `internationalPayments` is on in radar.config.ts. */
export const PRICE = {
  free: INTL ? '$0' : '₹0',
  pro: INTL ? usd(first) : inr(first),
  proPeriod: ` for ${first.days} days`,
  passLine: INTL
    ? `${usd(first)} for ${first.days} days, or ${inr(first)} in India`
    : `${inr(first)} for ${first.days} days`,
  passNote: 'Pay once. Time adds up: buying again adds days to the end.',
  /** The three passes in one sentence fragment, for the FAQ and the terms. */
  allPasses: `${priced(first)}, ${priced(second)}, ${priced(third)}`,
  /** The line under the Pro price on the landing page. */
  proMore: INTL
    ? `${inr(first)} in India. Also ${usd(second)} for ${second.days} days, ${usd(third)} for a year.`
    : `Also ${inr(second)} for ${second.days} days, ${inr(third)} for a year.`,
} as const;

export const FREE_FEATURES: readonly string[] = [
  'The ranked Read view across every source, no account needed',
  'With an account: an Ideas queue of up to 10 new stories a run, ranked by your topics',
  'Save any link to Ideas, up to 10 a day',
  '3 new page summaries a day; ones already read are free',
  'A Telegram digest of your top 5 stories after each run',
];

export const PRO_FEATURES: readonly string[] = [
  'Everything in Free, with higher limits: 30 saved links and 100 summaries a day',
  'A hook, an angle and a title draft written for each queued story',
  'An Ideas queue that learns from what you pick and skip',
  'Your own RSS feeds',
  'The full Telegram digest with hooks, web push and Notion sync',
];

/** One row of the Free vs Pro table on the Pricing page: text for a limit, true for included. */
export interface CompareRow {
  label: string;
  free: string | boolean;
  pro: string | boolean;
}

export const COMPARE: readonly CompareRow[] = [
  { label: 'The ranked Read view and search', free: true, pro: true },
  { label: 'Ideas queue, ranked by your topics', free: true, pro: true },
  { label: 'Saved links', free: '10 a day', pro: '30 a day' },
  { label: 'Page summaries', free: '3 a day', pro: '100 a day' },
  { label: 'A hook, an angle and a title draft for each queued story', free: false, pro: true },
  { label: 'A queue that learns from what you pick and skip', free: false, pro: true },
  { label: 'Your own RSS feeds', free: false, pro: true },
  { label: 'Telegram digest', free: 'Top 5, titles', pro: 'With hooks and angles' },
  { label: 'Web push and Notion sync', free: false, pro: true },
];
