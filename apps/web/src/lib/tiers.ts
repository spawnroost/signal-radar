/** What Free and Pro include. The Pricing page and the landing page both render these. */
import { INTERNATIONAL_PAYMENTS } from './passes';

const INTL = INTERNATIONAL_PAYMENTS;

/** Prices in marketing copy: rupees only until `internationalPayments` is on in radar.config.ts. */
export const PRICE = {
  free: INTL ? '$0' : '₹0',
  pro: INTL ? '$2' : '₹99',
  proPeriod: ' for 30 days',
  passLine: INTL ? '$2 for 30 days, or ₹99 in India' : '₹99 for 30 days',
  passNote: 'Pay once. Time adds up: buying again adds days to the end.',
  /** The three passes in one sentence fragment, for the FAQ and the terms. */
  allPasses: INTL
    ? '₹99 or $2 for 30 days, ₹249 or $5 for 90 days, ₹799 or $15 for a year'
    : '₹99 for 30 days, ₹249 for 90 days, ₹799 for a year',
  /** The line under the Pro price on the landing page. */
  proMore: INTL
    ? '₹99 in India. Also $5 for 90 days, $15 for a year.'
    : 'Also ₹249 for 90 days, ₹799 for a year.',
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
