import { createStore } from './store';
import { needsInstall } from './push';

interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
}

/** The browser's install prompt, held back until the app asks for it (null: not installable). */
const deferred = createStore<InstallEvent | null>(null);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred.set(e as InstallEvent);
  });
  window.addEventListener('appinstalled', () => deferred.set(null));
}

/** True when the app already runs from the home screen. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true
  );
}

export interface InstallState {
  /** Opens the browser's install prompt; null unless it is on offer (never when installed). */
  install: (() => void) | null;
  /** iPhone/iPad Safari: no prompt exists, so the app shows the Share-menu steps instead. */
  ios: boolean;
}

export function useInstall(): InstallState {
  const event = deferred.use();
  if (isStandalone()) return { install: null, ios: false };
  const ios = event === null && needsInstall();
  if (!event) return { install: null, ios };
  return {
    install: () => {
      void event.prompt();
      deferred.set(null);
    },
    ios: false,
  };
}

const VISITS_KEY = 'radar.visits';
const SESSION_KEY = 'radar.visitCounted';
const HINT_KEY = 'radar.installHint';

/** How many separate visits (browser sessions) this device has made, counting this one once. */
export function countVisit(): number {
  try {
    const seen = Number(localStorage.getItem(VISITS_KEY)) || 0;
    if (sessionStorage.getItem(SESSION_KEY)) return seen;
    sessionStorage.setItem(SESSION_KEY, '1');
    localStorage.setItem(VISITS_KEY, String(seen + 1));
    return seen + 1;
  } catch {
    return 0; // storage blocked: never nag
  }
}

export function installHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== null;
  } catch {
    return true;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* blocked storage: the hint just comes back next visit */
  }
}

/** The one-time install hint: from the second visit, once, and only where install is possible. */
export function shouldShowInstallHint(o: {
  visits: number;
  dismissed: boolean;
  installable: boolean;
}): boolean {
  return o.visits >= 2 && !o.dismissed && o.installable;
}
