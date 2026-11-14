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
];

export const PRO_FEATURES: readonly string[] = [
  'Everything in Free, with higher limits: 30 saved links and 100 summaries a day',
  'A hook, an angle and a title draft written for each queued story',
  'An Ideas queue that learns from what you pick and skip',
  'Your own RSS feeds',
  'A Telegram digest, web push and Notion sync',
];

/** The short Free/Pro lists on the Pricing page. */
export const FREE_SHORT: readonly string[] = [
  'The ranked Read view and search',
  'An Ideas queue and 3 summaries a day',
];

export const PRO_SHORT: readonly string[] = [
  '30 saved links and 100 summaries a day',
  'Hooks, angles and title drafts for queued stories',
  'Your RSS feeds, a Telegram digest and Notion sync',
];
