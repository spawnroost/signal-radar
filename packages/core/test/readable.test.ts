import { describe, expect, it } from 'vitest';
import { extractReadable, readMinutes, safeHttpUrl, sanitizeHtml } from '../src/readable.js';

describe('sanitizeHtml', () => {
  it('drops active content and unsafe attributes, keeps text and safe links', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="/ok" style="x">ok</a></p>' +
        '<script>alert(1)</script><style>p{}</style><iframe src="//e"></iframe>' +
        '<img src="data:image/png;base64,AA" alt="d"><img src="/i.png" alt="a&quot;b" onerror="x()">' +
        '<svg><script>1</script></svg><custom-tag>kept <b>bold</b></custom-tag>',
      'https://site.example/post',
    );
    expect(out).not.toMatch(/script|style|iframe|svg|onclick|onerror|javascript:|data:/i);
    expect(out).toContain(
      '<a href="https://site.example/ok" rel="noopener noreferrer nofollow" target="_blank">ok</a>',
    );
    expect(out).toContain('<a>bad</a>');
    expect(out).toContain('src="https://site.example/i.png" alt="a&quot;b"');
    expect(out).toContain('kept <b>bold</b>');
  });

  it('escapes text so markup cannot be smuggled back in', () => {
    expect(sanitizeHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });
});

describe('safeHttpUrl', () => {
  it('only passes http(s) URLs without credentials', () => {
    expect(safeHttpUrl('/x', 'https://a.example/y')).toBe('https://a.example/x');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://u:p@a.example/')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe('extractReadable', () => {
  it('falls back to the address when there is nothing to read', () => {
    expect(extractReadable('', 'https://www.example.com/a/b/').title).toBe('example.com/a/b');
  });
  it('readMinutes rounds and never drops a real page to zero', () => {
    expect([readMinutes(0), readMinutes(40), readMinutes(460), readMinutes(1150)]).toEqual([
      0, 1, 2, 5,
    ]);
  });
});
