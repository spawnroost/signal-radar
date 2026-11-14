import { useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Better Auth email/password endpoints, called with plain fetch (no client dependency). */
export function signUp(email: string, password: string): Promise<unknown> {
  const name = email.split('@')[0] || email;
  return api('/api/auth/sign-up/email', { method: 'POST', json: { name, email, password } });
}

export function signIn(email: string, password: string): Promise<unknown> {
  return api('/api/auth/sign-in/email', { method: 'POST', json: { email, password } });
}

export type Provider = 'google' | 'github';

export interface AuthMethods {
  google: boolean;
  github: boolean;
  /** The server accepts email + password. */
  email: boolean;
  /** Email + password is the only way in, so it is the main form rather than a dev extra. */
  emailPrimary: boolean;
}

/** What to show when the server can't be reached: the email form, so the screen is not empty. */
export const FALLBACK_METHODS: AuthMethods = {
  google: false,
  github: false,
  email: true,
  emailPrimary: true,
};

let methodsCache: Promise<AuthMethods> | null = null;

/** Which sign-in methods the server offers; asked once per page load. */
export function fetchAuthMethods(): Promise<AuthMethods> {
  methodsCache ??= api<AuthMethods>('/api/auth-methods').catch(() => {
    methodsCache = null;
    return FALLBACK_METHODS;
  });
  return methodsCache;
}

/** Null until the server has answered. */
export function useAuthMethods(): AuthMethods | null {
  const [methods, setMethods] = useState<AuthMethods | null>(null);
  useEffect(() => {
    let live = true;
    void fetchAuthMethods().then((m) => live && setMethods(m));
    return () => {
      live = false;
    };
  }, []);
  return methods;
}

export const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', github: 'GitHub' };

/** The providers the server has switched on, in display order. */
export function enabledProviders(methods: AuthMethods): Provider[] {
  return (['google', 'github'] as const).filter((p) => methods[p]);
}

/** Starts social sign-in: the server answers with the provider's URL and the browser leaves for it. */
export async function signInWithProvider(
  provider: Provider,
  returnTo: string,
  newUserTo: string,
): Promise<void> {
  const origin = window.location.origin;
  const res = await api<{ url?: string }>('/api/auth/sign-in/social', {
    method: 'POST',
    json: {
      provider,
      callbackURL: origin + returnTo,
      newUserCallbackURL: origin + newUserTo,
      errorCallbackURL: origin + '/signin',
    },
  });
  if (!res.url) throw new Error(`${PROVIDER_NAME[provider]} sign-in did not start. Try again.`);
  window.location.assign(res.url);
}

export function signOut(): Promise<unknown> {
  return api('/api/auth/sign-out', { method: 'POST', json: {} });
}

/** Turns an auth failure into a sentence that names the problem and the way out. */
export function authErrorMessage(err: unknown, mode: 'signin' | 'signup'): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Try again.';
  if (err.status === 0) return 'Could not reach the server. Check your connection and try again.';
  if (mode === 'signin' && (err.status === 401 || err.status === 400)) {
    return 'That email and password do not match.';
  }
  if (mode === 'signup' && (err.code === 'USER_ALREADY_EXISTS' || err.status === 422)) {
    return 'An account with that email already exists. Sign in instead.';
  }
  if (err.code === 'PASSWORD_TOO_SHORT') return 'Use a password of at least 8 characters.';
  if (err.status === 403) return 'The server refused this request. Reload the page and try again.';
  return err.message;
}
