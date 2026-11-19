import { describe, expect, it } from 'vitest';
import {
  fetchTopicSources,
  findSubreddits,
  bingArticleUrl,
  googleNewsUrl,
  newsQueryFor,
  parseBingNews,
  pickSubreddits,
  redditHotUrl,
  topicSourceKey,
  topicSourceLabel,
  topicSourcesOf,
  withoutTopicSource,
  withTopicSources,
  NicheSchema,
  type Niche,
} from '../src/index.js';
import { NOW, res, routedFetch } from './helpers.js';

const fashion: Niche = { id: 'c1', name: 'Fashion', weight: 1, keywords: ['fashion'] };

const SEARCH = `<feed><entry><title>Fashion and Style</title><link href="https://www.reddit.com/r/fashion/" /></entry>
<entry><title>x</title><link href="https://www.reddit.com/r/Fashion/" /></entry>
<entry><title>y</title><link href="https://www.reddit.com/r/streetwear/" /></entry>
<entry><title>z</title><link href="https://www.reddit.com/r/malefashionadvice/" /></entry></feed>`;

const NEWS = `<rss version="2.0"><channel><item><title>Paris week opens - Vogue</title>
<link>https://news.google.com/rss/articles/a</link><pubDate>Mon, 09 Nov 2026 01:00:00 GMT</pubDate></item></channel></rss>`;

const bingItem = (title: string, url: string, source: string) =>
  `<item><title>${title}</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=t1&amp;url=${encodeURIComponent(url).replace(/%2F/g, '%2f')}&amp;c=1&amp;mkt=en-us</link>` +
  `<description>Snippet</description><pubDate>Mon, 09 Nov 2026 01:00:00 GMT</pubDate><News:Source>${source}</News:Source></item>`;

const BING = `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://www.bing.com/news/search"><channel><title>fashion</title>
<link>https://www.bing.com/news/search?q=fashion&amp;format=rss</link>
${bingItem('Paris week opens', 'https://www.vogue.com/a?x=1&y=2', 'Vogue')}
<item><title>No target</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=</link><News:Source>X</News:Source></item>
</channel></rss>`;

const reddit = (sub: string, title: string, url: string) =>
  `<entry><category term="${sub}" label="r/${sub}"/><title>${title}</title><link href="${url}"/>` +
  `<updated>2026-11-09T03:00:00+00:00</updated><content type="html"></content></entry>`;

describe('topic sources', () => {
  it('builds the news query from the name and first keywords, quoting phrases', () => {
    expect(newsQueryFor(fashion)).toBe('Fashion');
    expect(
      newsQueryFor({
        name: 'Handhelds',
        keywords: ['steam deck', { term: 'rog ally', weight: 2 }, 'x1', 'x2', 'x3'],
      }),
    ).toBe('Handhelds OR "steam deck" OR "rog ally" OR x1');
  });

  it('keeps the query within 100 characters', () => {
    const long = Array.from({ length: 4 }, (_, i) => `${'word'.repeat(7)}${i}`);
    const q = newsQueryFor({ name: 'Long', keywords: long });
    expect(q.length).toBeLessThanOrEqual(100);
    expect(q.startsWith('Long OR ')).toBe(true);
  });

  it('encodes the Google News URL and joins subreddits into one request', () => {
    expect(googleNewsUrl('steam deck & "rog ally"')).toBe(
      'https://news.google.com/rss/search?q=steam%20deck%20%26%20%22rog%20ally%22&hl=en-US&gl=US&ceid=US:en',
    );
    expect(redditHotUrl(['fashion', 'streetwear'], 50)).toBe(
      'https://www.reddit.com/r/fashion+streetwear/hot/.rss?limit=50',
    );
  });

  it('extracts the publisher URL from a Bing click-through link', () => {
    const good =
      'http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=9&amp;url=https%3a%2f%2fwww.msn.com%2fen-us%2fmoney%2fa-1&amp;c=1&amp;mkt=en-us';
    expect(bingArticleUrl(good)).toBe('https://www.msn.com/en-us/money/a-1');
    expect(bingArticleUrl(good.replace(/&amp;/g, '&'))).toBe('https://www.msn.com/en-us/money/a-1');
    const encoded = `http://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent('https://a.com/p?q=a b&r=ü')}&c=1`;
    expect(bingArticleUrl(encoded)).toBe('https://a.com/p?q=a%20b&r=%C3%BC');
    expect(bingArticleUrl('http://www.bing.com/news/apiclick.aspx?ref=FexRss&aid=')).toBeNull();
    expect(
      bingArticleUrl('http://www.bing.com/news/apiclick.aspx?url=javascript%3Aalert(1)'),
    ).toBeNull();
    expect(
      bingArticleUrl('http://www.bing.com/news/apiclick.aspx?url=ftp%3a%2f%2fa.com%2fx'),
    ).toBeNull();
    expect(bingArticleUrl('not a url')).toBeNull();
  });

  it('parses Bing News items with publisher URLs and names, dropping unreadable ones', () => {
    const raws = parseBingNews(BING);
    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({
      title: 'Paris week opens',
      url: 'https://www.vogue.com/a?x=1&y=2',
      sourceName: 'Vogue',
    });
  });

  it('picks at most two distinct subreddits, best match first', () => {
    expect(pickSubreddits(SEARCH)).toEqual([
      { type: 'reddit', sub: 'fashion' },
      { type: 'reddit', sub: 'streetwear' },
    ]);
    expect(pickSubreddits('<feed></feed>')).toEqual([]);
  });

  it('labels, keys and defaults sources', () => {
    const s = topicSourcesOf(fashion);
    expect(s).toEqual([{ type: 'news', query: 'Fashion' }]);
    expect(topicSourceLabel(s[0]!)).toBe('News: Fashion');
    expect(topicSourceLabel({ type: 'reddit', sub: 'fashion' })).toBe('r/fashion');
    expect(topicSourceKey({ type: 'reddit', sub: 'Fashion' })).toBe('reddit:fashion');
  });

  it('removing a topic source drops it for good, and removing the topic drops all of them', () => {
    const full = withTopicSources(fashion, [{ type: 'reddit', sub: 'fashion' }]);
    expect(full.sources).toHaveLength(2);
    const noNews = withoutTopicSource(full, 'news:fashion');
    expect(noNews.sources).toEqual([{ type: 'reddit', sub: 'fashion' }]);
    const none = withoutTopicSource(noNews, 'reddit:fashion');
    expect(none.sources).toEqual([]);
    expect(topicSourcesOf(none)).toEqual([]);
    // Sources live on the topic, so they leave with it.
    const rest = [full, { ...fashion, id: 'c2' }].filter((n) => n.id !== 'c1');
    expect(rest.flatMap(topicSourcesOf).some((x) => x.type === 'reddit')).toBe(false);
  });

  it('does not overwrite sources a topic already has', () => {
    const own = { ...fashion, sources: [] };
    expect(withTopicSources(own, [{ type: 'reddit', sub: 'x1' }]).sources).toEqual([]);
  });

  it('validates sources on the niche schema', () => {
    const ok = NicheSchema.safeParse({ ...fashion, sources: [{ type: 'reddit', sub: 'fashion' }] });
    expect(ok.success).toBe(true);
    for (const bad of [
      { type: 'reddit', sub: 'a b' },
      { type: 'reddit', sub: '../x' },
      { type: 'rss', url: 'http://169.254.169.254' },
      { type: 'news', query: '' },
    ]) {
      expect(NicheSchema.safeParse({ ...fashion, sources: [bad] }).success).toBe(false);
    }
    const four = Array.from({ length: 4 }, (_, i) => ({ type: 'reddit', sub: `sub${i}x` }));
    expect(NicheSchema.safeParse({ ...fashion, sources: four }).success).toBe(false);
  });
});

describe('fetching topic sources', () => {
  it('fetches news once per distinct query and all subreddits in a single request', async () => {
    const xml = `<feed>${reddit('fashion', 'OOTD thread', 'https://www.reddit.com/r/fashion/c1')}${reddit('streetwear', 'Drops', 'https://www.reddit.com/r/streetwear/c2')}</feed>`;
    const fetch = routedFetch({
      'bing.com/news': () => res(BING),
      'reddit.com/r/fashion+streetwear': () => res(xml),
    });
    const out = await fetchTopicSources(
      [
        { type: 'news', query: 'Fashion' },
        { type: 'news', query: 'fashion' },
        { type: 'reddit', sub: 'fashion' },
        { type: 'reddit', sub: 'streetwear' },
      ],
      fetch,
      NOW,
    );
    expect(fetch.calls).toHaveLength(2);
    expect(out.failed).toEqual([]);
    expect(out.items.get('news:fashion')?.[0]).toMatchObject({
      title: 'Paris week opens',
      url: 'https://www.vogue.com/a?x=1&y=2',
      source: 'Vogue',
      sourceKind: 'rss',
    });
    expect(out.items.get('reddit:fashion')?.map((i) => i.title)).toEqual(['OOTD thread']);
    expect(out.items.get('reddit:streetwear')?.[0]).toMatchObject({
      source: 'r/streetwear',
      sourceKind: 'reddit',
    });
  });

  it('reports a failing source and keeps the others', async () => {
    const fetch = routedFetch({
      'bing.com/news': () => res(BING),
      'reddit.com': () => res('', 429),
    });
    const warnings: string[] = [];
    const out = await fetchTopicSources(
      [
        { type: 'news', query: 'Fashion' },
        { type: 'reddit', sub: 'fashion' },
      ],
      fetch,
      NOW,
      { warn: (m) => warnings.push(m) },
    );
    expect(out.failed).toEqual(['reddit:fashion']);
    expect(out.items.has('news:fashion')).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  describe('news fallback', () => {
    const src = [{ type: 'news' as const, query: 'Fashion' }];
    const googleOnly = (bing: () => Response) =>
      routedFetch({ 'bing.com/news': bing, 'news.google.com': () => res(NEWS) });

    it('falls back to Google News when Bing throws or answers non-2xx', async () => {
      for (const bing of [
        () => {
          throw new Error('boom');
        },
        () => res('', 503),
      ]) {
        const fetch = googleOnly(bing);
        const out = await fetchTopicSources(src, fetch, NOW);
        expect(out.failed).toEqual([]);
        expect(fetch.calls).toHaveLength(2);
        expect(out.items.get('news:fashion')?.[0]).toMatchObject({ source: 'Vogue' });
      }
    });

    it('falls back to Google News when Bing has no usable items', async () => {
      const empty = '<rss version="2.0"><channel><title>x</title></channel></rss>';
      for (const body of [empty, BING.replace(/<item><title>Paris[\s\S]*?<\/item>/, '')]) {
        const fetch = googleOnly(() => res(body));
        const out = await fetchTopicSources(src, fetch, NOW);
        expect(fetch.calls).toHaveLength(2);
        expect(out.items.get('news:fashion')).toHaveLength(1);
      }
    });

    it('uses Bing alone when it answers', async () => {
      const fetch = googleOnly(() => res(BING));
      await fetchTopicSources(src, fetch, NOW);
      expect(fetch.calls).toHaveLength(1);
    });

    it('reports the source as failed, without throwing, when both fail', async () => {
      const fetch = routedFetch({
        'bing.com/news': () => res('', 500),
        'news.google.com': () => res('', 500),
      });
      const warnings: string[] = [];
      const out = await fetchTopicSources(src, fetch, NOW, { warn: (m) => warnings.push(m) });
      expect(out.failed).toEqual(['news:fashion']);
      expect(out.items.has('news:fashion')).toBe(false);
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  it('finds subreddits through the keyless search feed', async () => {
    const fetch = routedFetch({ 'reddit.com/subreddits/search.rss': () => res(SEARCH) });
    expect(await findSubreddits('fashion', fetch)).toHaveLength(2);
    expect(fetch.calls[0]).toContain('q=fashion');
  });
});
