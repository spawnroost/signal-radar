import type { Item, ScoredItem } from './schema.js';
import type { Prefiltered } from './prefilter.js';

/** Weight of momentum (a 0..1 rank within the item's own source) against keyword relevance. */
const MOMENTUM_WEIGHT = 36;
/** Momentum for sources that report no engagement (RSS, Reddit RSS): the middle of the pack. */
const NEUTRAL = 0.5;
/**
 * Ranking score: keyword relevance plus momentum, where momentum is the item's rank (0..1) among
 * items from the same source. GitHub stars and HN points are on different scales, so comparing raw
 * per-hour numbers let one source flood the top.
 */
export function rankScore(keywordScore: number, momentumRank: number): number {
  return Math.round((keywordScore * 4 + MOMENTUM_WEIGHT * momentumRank) * 10) / 10;
}

/** Each item's per-hour momentum as a 0..1 rank within its source kind (ties share the mean). */
export function momentumRanks(items: readonly Item[]): Map<Item, number> {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const g = groups.get(it.sourceKind);
    if (g) g.push(it);
    else groups.set(it.sourceKind, [it]);
  }
  const out = new Map<Item, number>();
  for (const group of groups.values()) {
    const values = group.map((i) => i.momentum.perHour).sort((a, b) => a - b);
    if (group.length < 2 || values[values.length - 1] === 0) {
      for (const it of group) out.set(it, NEUTRAL);
      continue;
    }
    for (const it of group) {
      const v = it.momentum.perHour;
      const first = values.indexOf(v);
      const last = values.lastIndexOf(v);
      out.set(it, (first + last) / 2 / (values.length - 1));
    }
  }
  return out;
}

/**
 * Mix key: each RSS feed (YouTube channel, Medium tag, a user's own feed) counts as its own source,
 * so feeds do not share one "rss" slot; hn/reddit/github and the rest count once each.
 */
export function mixKey(it: { sourceKind: string; source?: string }): string {
  return it.sourceKind === 'rss' && it.source ? `rss:${it.source}` : it.sourceKind;
}

/**
 * Round-robin over sources so the list carries news from everywhere: every source's best item
 * comes first (in score order), then every source's second-best, and so on. A source with many
 * items (GitHub) fills the tail instead of the top; a quiet one (a YouTube channel, a user's own
 * feed) still gets its best item near the top.
 */
export function mixSources<T extends { sourceKind: string; source?: string }>(
  sorted: readonly T[],
): T[] {
  const rounds: T[][] = [];
  const seen = new Map<string, number>();
  for (const it of sorted) {
    const k = mixKey(it);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    (rounds[n] ??= []).push(it);
  }
  return rounds.flat();
}

export function rank(items: Prefiltered[], topN: number): ScoredItem[] {
  const ranks = momentumRanks(items.map((p) => p.item));
  const sorted = items
    .map(({ item, keywordScore, niches }) => ({
      ...item,
      tags: [...new Set([...item.tags, ...niches])],
      keywordScore,
      niches,
      score: rankScore(keywordScore, ranks.get(item) ?? NEUTRAL),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? '') ||
        a.title.localeCompare(b.title),
    );
  return mixSources(sorted).slice(0, topN);
}
