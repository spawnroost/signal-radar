import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countVisit,
  dismissInstallHint,
  installHintDismissed,
  isStandalone,
  shouldShowInstallHint,
} from '../src/lib/install';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

const ok = { visits: 2, dismissed: false, installable: true };

describe('shouldShowInstallHint', () => {
  it('shows from the second visit, when installable and not dismissed', () => {
    expect(shouldShowInstallHint(ok)).toBe(true);
    expect(shouldShowInstallHint({ ...ok, visits: 9 })).toBe(true);
  });

  it('never shows on a first visit, once dismissed, or where install is impossible', () => {
    expect(shouldShowInstallHint({ ...ok, visits: 1 })).toBe(false);
    expect(shouldShowInstallHint({ ...ok, visits: 0 })).toBe(false);
    expect(shouldShowInstallHint({ ...ok, dismissed: true })).toBe(false);
    expect(shouldShowInstallHint({ ...ok, installable: false })).toBe(false);
  });
});

describe('visit counting and dismissal', () => {
  let local: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    local = memoryStorage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('counts a browser session once, however often it is asked', () => {
    expect(countVisit()).toBe(1);
    expect(countVisit()).toBe(1);
    expect(local.getItem('radar.visits')).toBe('1');
  });

  it('counts the next session as the second visit', () => {
    countVisit();
    vi.stubGlobal('sessionStorage', memoryStorage());
    expect(countVisit()).toBe(2);
  });

  it('keeps the hint dismissed once it is', () => {
    expect(installHintDismissed()).toBe(false);
    dismissInstallHint();
    expect(installHintDismissed()).toBe(true);
  });

  it('never nags when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('localStorage', blocked);
    expect(countVisit()).toBe(0);
    expect(installHintDismissed()).toBe(true);
    expect(() => dismissInstallHint()).not.toThrow();
  });
});

describe('isStandalone', () => {
  const env = (standalone: boolean | undefined, matches: boolean) => {
    vi.stubGlobal('navigator', { standalone });
    vi.stubGlobal('window', { matchMedia: () => ({ matches }) });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('is true for the standalone display mode and for iOS standalone', () => {
    env(undefined, true);
    expect(isStandalone()).toBe(true);
    env(true, false);
    expect(isStandalone()).toBe(true);
  });

  it('is false in a plain browser tab', () => {
    env(false, false);
    expect(isStandalone()).toBe(false);
  });
});
