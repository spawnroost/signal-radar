import { describe, expect, it } from 'vitest';
import { META_SEP } from '../src/lib/format';
import {
  bookmarklet,
  clearPendingSave,
  parseTagInput,
  peekPendingSave,
  rememberPendingSave,
  saveMeta,
  sharedUrl,
  toSaveUrl,
  type SavedItem,
} from '../src/lib/saves';

const p = (q: string) => new URLSearchParams(q);

describe('sharedUrl', () => {
  it('takes the url param first', () => {
    expect(sharedUrl(p('url=https%3A%2F%2Fa.example%2Fx&text=ignored'))).toBe(
      'https://a.example/x',
    );
  });
  it('finds the link inside shared text (Android puts it there)', () => {
    expect(
      sharedUrl(p('text=' + encodeURIComponent('Worth a read: https://a.example/x?y=1.'))),
    ).toBe('https://a.example/x?y=1');
  });
  it('falls back to the title and gives up on nothing usable', () => {
    expect(sharedUrl(p('title=' + encodeURIComponent('see http://b.example/')))).toBe(
      'http://b.example/',
    );
    expect(sharedUrl(p('text=hello+world'))).toBeNull();
    expect(sharedUrl(p(''))).toBeNull();
    expect(sharedUrl(p('url=javascript%3Aalert(1)'))).toBeNull();
  });
});

describe('toSaveUrl', () => {
  it('adds https and refuses non-web or host-less input', () => {
    expect(toSaveUrl('example.com/a')).toBe('https://example.com/a');
    expect(toSaveUrl('ftp://example.com')).toBeNull();
    expect(toSaveUrl('localhost')).toBeNull();
    expect(toSaveUrl('two words')).toBeNull();
  });
});

describe('bookmarklet', () => {
  it('opens the save page of the given origin with the current address', () => {
    const b = bookmarklet('https://radar.example');
    expect(b.startsWith('javascript:')).toBe(true);
    expect(b).toContain('"https://radar.example/save?url="');
    expect(b).toContain('encodeURIComponent(location.href)');
  });
});

describe('pending save', () => {
  it('round-trips through storage', () => {
    const data = new Map<string, string>();
    const storage = {
      setItem: (k: string, v: string) => void data.set(k, v),
      getItem: (k: string) => data.get(k) ?? null,
      removeItem: (k: string) => void data.delete(k),
    };
    expect(peekPendingSave(storage)).toBeNull();
    rememberPendingSave(storage, 'https://a.example/');
    expect(peekPendingSave(storage)).toBe('https://a.example/');
    clearPendingSave(storage);
    expect(peekPendingSave(storage)).toBeNull();
  });
});

describe('parseTagInput', () => {
  it('splits on commas, lower-cases and skips repeats', () => {
    expect(parseTagInput(' AI tools, python,,Python , rust', ['rust'])).toEqual([
      'ai tools',
      'python',
    ]);
  });
});

describe('saveMeta', () => {
  const base = {
    siteName: 'Metro Daily',
    readMinutes: 4,
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  } as SavedItem;
  it('joins what is known', () => {
    expect(saveMeta(base)).toBe(['Metro Daily', '4 min read', '2d'].join(META_SEP));
    expect(saveMeta({ ...base, siteName: null, readMinutes: 0 })).toBe('2d');
  });
});
