import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

/** A page ready for the reader view. `contentHtml` is sanitized and safe to render as HTML. */
export interface ReadablePage {
  title: string;
  siteName: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  contentHtml: string | null;
  wordCount: number;
}

/** Sanitized article HTML is cut to this many characters. */
export const MAX_CONTENT_CHARS = 400_000;
const WORDS_PER_MINUTE = 230;

/** Whole minutes to read `words` words, never less than one for a page with text. */
export function readMinutes(words: number): number {
  return words <= 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

const ALLOWED = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'sub',
  'sup',
  'mark',
  'small',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
]);
/** Dropped together with everything inside them. */
const DROP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'math',
  'canvas',
  'audio',
  'video',
  'link',
  'meta',
  'head',
  'title',
  'base',
  'nav',
  'aside',
]);
const VOID = new Set(['br', 'hr', 'img']);

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

/** An absolute http(s) URL (resolved against `base`), or null for anything else. */
export function safeHttpUrl(raw: string | null | undefined, base?: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim(), base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    const href = u.href;
    return href.length <= 2000 ? href : null;
  } catch {
    return null;
  }
}

interface Node_ {
  nodeType: number;
  nodeName: string;
  nodeValue?: string | null;
  childNodes: ArrayLike<Node_>;
  getAttribute?: (n: string) => string | null;
}

/**
 * Allow-list sanitizer: rebuilds the HTML from text nodes and a fixed set of tags and attributes
 * (a/href, img/src/alt only), so nothing a page ships can run script or load active content.
 * Unknown tags are unwrapped; dangerous ones are dropped with their content.
 */
export function sanitizeHtml(html: string, baseUrl?: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const out: string[] = [];
  const walk = (node: Node_) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out.push(escText(child.nodeValue ?? ''));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.nodeName.toLowerCase();
      if (DROP.has(tag)) continue;
      if (!ALLOWED.has(tag)) {
        walk(child);
        continue;
      }
      if (tag === 'img') {
        const src = safeHttpUrl(child.getAttribute?.('src'), baseUrl);
        if (src) {
          const alt = child.getAttribute?.('alt') ?? '';
          out.push(
            `<img src="${escAttr(src)}" alt="${escAttr(alt.slice(0, 300))}" loading="lazy" referrerpolicy="no-referrer">`,
          );
        }
        continue;
      }
      if (tag === 'a') {
        const href = safeHttpUrl(child.getAttribute?.('href'), baseUrl);
        out.push(
          href
            ? `<a href="${escAttr(href)}" rel="noopener noreferrer nofollow" target="_blank">`
            : '<a>',
        );
      } else {
        out.push(`<${tag}>`);
      }
      if (!VOID.has(tag)) {
        walk(child);
        out.push(`</${tag}>`);
      }
    }
  };
  walk(document.body as unknown as Node_);
  return out.join('');
}

const clean = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

interface MetaDoc {
  querySelector(
    selector: string,
  ): { getAttribute(n: string): string | null; textContent: string | null } | null;
}

const metaOf = (document: MetaDoc, key: string): string | null => {
  const el = document.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
  return clean(el?.getAttribute('content'), 2000);
};

/** Readable title/site/excerpt/lead image/content from raw HTML. Never throws; fields may be empty. */
export function extractReadable(html: string, url: string): ReadablePage {
  const fallbackTitle = titleFromUrl(url);
  try {
    const meta = parseHTML(html).document as unknown as MetaDoc;
    const ogTitle =
      metaOf(meta, 'og:title') ?? clean(meta.querySelector('title')?.textContent, 300);
    const siteName = metaOf(meta, 'og:site_name');
    const ogDesc = metaOf(meta, 'og:description') ?? metaOf(meta, 'description');
    const imageUrl = safeHttpUrl(metaOf(meta, 'og:image') ?? metaOf(meta, 'twitter:image'), url);

    const { document } = parseHTML(html);
    try {
      Object.defineProperty(document, 'documentURI', { value: url, configurable: true });
    } catch {
      /* relative links are resolved again by the sanitizer */
    }
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
      { charThreshold: 200 },
    ).parse();

    const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const contentHtml = article?.content
      ? sanitizeHtml(article.content, url).slice(0, MAX_CONTENT_CHARS) || null
      : null;
    return {
      title: clean(article?.title, 300) ?? ogTitle?.slice(0, 300) ?? fallbackTitle,
      siteName: clean(article?.siteName, 120) ?? siteName?.slice(0, 120) ?? null,
      excerpt: clean(article?.excerpt, 400) ?? ogDesc?.slice(0, 400) ?? clean(text, 300),
      imageUrl,
      contentHtml,
      wordCount: text ? text.split(' ').length : 0,
    };
  } catch {
    return {
      title: fallbackTitle,
      siteName: null,
      excerpt: null,
      imageUrl: null,
      contentHtml: null,
      wordCount: 0,
    };
  }
}

/** "example.com/some/path": the title of a save whose page could not be read. */
export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}`.slice(0, 300);
  } catch {
    return url.slice(0, 300);
  }
}
