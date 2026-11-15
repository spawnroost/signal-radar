import { describe, expect, it } from 'vitest';
import { normalizeItem } from '../src/normalize.js';
import { prefilter } from '../src/prefilter.js';
import { mixSources, momentumRanks, rank, rankScore } from '../src/rank.js';
import { NOW, niches } from './helpers.js';

const mk = (title: string, snippet = '', extra: { points?: number; ageH?: number } = {}) =>
  normalizeItem(
    {
      url: `https://x.com/${encodeURIComponent(title)}`,
      title,
      snippet,
      points: extra.points,
      publishedAt: new Date(NOW.getTime() - (extra.ageH ?? 1) * 3_600_000),
    },
    { name: 'S', kind: 'hn' },
    NOW,
  )!;

describe('prefilter', () => {
  it('drops zero-hit items and keeps hits', () => {
    const out = prefilter([mk('Cooking pasta at home'), mk('Claude ships a new agent')], niches);
    expect(out.map((o) => o.item.title)).toEqual(['Claude ships a new agent']);
    expect(out[0]?.niches).toEqual(['ai']);
  });

  it('keeps zero-hit items from alwaysInclude sources', () => {
    const out = prefilter([mk('Cooking pasta at home')], niches, () => true);
    expect(out).toHaveLength(1);
    expect(out[0]?.keywordScore).toBe(0);
  });

  it('weights title hits above body hits and applies keyword weights', () => {
    const [title] = prefilter([mk('Xenia update')], niches);
    const [body] = prefilter([mk('An update', 'about xenia')], niches);
    expect(title?.keywordScore).toBe(6); // 3 (title) * weight 2
    expect(body?.keywordScore).toBe(2); // 1 (body) * weight 2
  });

  it('matches whole words only and is case-insensitive', () => {
    expect(prefilter([mk('Pagentry and agentic')], niches)).toHaveLength(0);
    expect(prefilter([mk('New LLMs everywhere')], niches)).toHaveLength(1);
    expect(prefilter([mk('STEAM DECK news')], niches)).toHaveLength(1);
  });

  it('counts hits across niches', () => {
    const [m] = prefilter([mk('Claude agent on the Steam Deck')], niches);
    expect(m?.niches).toEqual(['ai', 'handheld']);
    expect(m?.keywordScore).toBe(9);
  });
});

describe('rank', () => {
  it('orders by combined keyword + momentum score and honours topN', () => {
    const items = prefilter(
      [
        mk('Claude agent', '', { points: 10, ageH: 10 }),
        mk('Claude agent news', '', { points: 900, ageH: 3 }),
        mk('OpenAI llm', '', { points: 0 }),
      ],
      niches,
    );
    const ranked = rank(items, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.title).toBe('Claude agent news');
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? Infinity);
  });

  it('rankScore grows with both inputs', () => {
    expect(rankScore(3, 0.9)).toBeGreaterThan(rankScore(3, 0.1));
    expect(rankScore(6, 0.5)).toBeGreaterThan(rankScore(3, 0.5));
  });

  it('ranks momentum within each source, so a busy source cannot flood the top', () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) => ({
        ...mk(`repo ${i}`, ''),
        sourceKind: 'github' as const,
        momentum: { perHour: 80 + i },
      })),
      { ...mk('hn top', ''), sourceKind: 'hn' as const, momentum: { perHour: 15 } },
      { ...mk('hn low', ''), sourceKind: 'hn' as const, momentum: { perHour: 1 } },
      { ...mk('rss post', ''), sourceKind: 'rss' as const, momentum: { perHour: 0 } },
    ];
    const ranks = momentumRanks(items);
    expect(ranks.get(items[6]!)).toBe(1);
    expect(ranks.get(items[5]!)).toBe(1);
    expect(ranks.get(items[8]!)).toBe(0.5);
    const out = rank(
      items.map((item) => ({ item, keywordScore: 0, niches: [] })),
      9,
    );
    expect(out.map((x) => x.title)).toEqual([
      'hn top',
      'repo 5',
      'repo 4',
      'rss post',
      'repo 3',
      'repo 2',
      'hn low',
      'repo 1',
      'repo 0',
    ]);
  });

  it('mixSources caps runs at two and a source at 40% of the top 20', () => {
    const list = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, sourceKind: 'github' })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, sourceKind: 'hn' })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, sourceKind: 'reddit' })),
    ];
    const out = mixSources(list);
    expect(out).toHaveLength(90);
    const top = out.slice(0, 20);
    expect(top.filter((x) => x.sourceKind === 'github')).toHaveLength(8);
    expect(top.slice(0, 3).map((x) => x.id)).toEqual(['g0', 'g1', 'h0']);
    for (let i = 2; i < 20; i++) {
      expect(
        new Set([top[i - 2], top[i - 1], top[i]].map((x) => x?.sourceKind)).size,
      ).toBeGreaterThan(1);
    }
  });

  it('computes perHour from points and age (floored at 1h)', () => {
    expect(mk('a b c', '', { points: 100, ageH: 10 }).momentum.perHour).toBe(10);
    expect(mk('a b d', '', { points: 100, ageH: 0.1 }).momentum.perHour).toBe(100);
  });
});
