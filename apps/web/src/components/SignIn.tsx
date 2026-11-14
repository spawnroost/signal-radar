import { useState, type FormEvent } from 'react';
import { authErrorMessage, enabledProviders, signIn, signUp, useAuthMethods } from '../lib/auth';
import { takeGateNext } from '../lib/gate';
import { refreshMe, type MeState } from '../lib/me';
import { navigate } from '../lib/route';
import { RadarArcs, RadarMark } from '../icons';
import { Link } from './Link';
import { ProviderButtons } from './ProviderButtons';
import { ProvidersSkeleton } from './Skeletons';

interface Props {
  me: MeState;
  startSignup: boolean;
  onSignOut: () => void;
}

export function SignIn({ me, startSignup, onSignOut }: Props) {
  const methods = useAuthMethods();
  const [mode, setMode] = useState<'signin' | 'signup'>(startSignup ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Providers send failed sign-ins back here with ?error=...
  const [error, setError] = useState(() =>
    new URLSearchParams(window.location.search).has('error')
      ? 'Sign-in did not finish. Try again.'
      : '',
  );

  if (me.status === 'ready') {
    return (
      <section className="auth" aria-labelledby="auth-title">
        <h2 id="auth-title" className="page-title">
          Signed in
        </h2>
        <p className="lede">
          You are signed in as <span className="mono-inline">{me.me.user.email}</span>.
        </p>
        <div className="auth-actions">
          <Link to="queue" className="btn btn-solid">
            Open the queue
          </Link>
          <button type="button" className="text-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
    );
  }

  const providers = methods ? enabledProviders(methods) : [];
  const emailOnly = methods?.emailPrimary === true;
  // The email form is the main UI when it is the only way in. Beside providers it is a hidden
  // door for accounts made out of band (a payment reviewer's test login): it opens only from
  // /signin?method=password, signs in only, and is not linked from anywhere.
  const passwordOnly =
    !emailOnly && new URLSearchParams(window.location.search).get('method') === 'password';
  const showForm = methods !== null && methods.email && (emailOnly || passwordOnly);
  const signup = emailOnly && mode === 'signup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await (signup ? signUp(email.trim(), password) : signIn(email.trim(), password));
      await refreshMe();
      // A new account still needs onboarding; an existing one returns where it was asked from.
      const back = takeGateNext();
      navigate(signup ? '/welcome' : (back ?? '/queue'));
    } catch (err) {
      setError(authErrorMessage(err, mode));
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    setMode(signup ? 'signin' : 'signup');
    setError('');
  };

  return (
    <section className="auth" aria-labelledby="auth-title">
      <div className="auth-head">
        <span className="auth-mark">
          <RadarArcs className="auth-arcs" />
          <RadarArcs className="auth-arcs auth-arcs-l" />
          <RadarMark />
        </span>
        <h2 id="auth-title" className="page-title">
          {signup ? 'Create your account' : 'Sign in'}
        </h2>
        <p className="lede">
          {passwordOnly
            ? 'Stories worth making something about, found for you every day.'
            : 'Stories worth making something about, found for you every day. Pro is free for 7 days, no card needed.'}
        </p>
      </div>

      {methods === null && <ProvidersSkeleton />}

      {providers.length > 0 && <ProviderButtons providers={providers} onError={setError} />}

      {showForm && (
        <form onSubmit={submit} noValidate={false} className="form auth-form">
          <label className="field">
            <span className="field-label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
            />
          </label>
          <label className="field">
            <span className="field-label">Password{signup ? ', at least 8 characters' : ''}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? 'new-password' : 'current-password'}
              minLength={signup ? 8 : undefined}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'auth-error' : undefined}
            />
          </label>
          {error && (
            <p id="auth-error" className="warn" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-solid auth-submit" disabled={busy}>
            {busy ? 'One moment' : signup ? 'Start free trial' : 'Sign in'}
          </button>
          {emailOnly && (
            <button type="button" className="text-btn auth-switch" onClick={toggle}>
              {signup ? 'I already have an account' : 'Create an account'}
            </button>
          )}
        </form>
      )}

      {!showForm && error && (
        <p id="auth-error" className="warn auth-error" role="alert">
          {error}
        </p>
      )}

      {methods !== null && (
        <p className="meta auth-legal">
          By continuing you accept the{' '}
          <Link to="terms" className="link">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="privacy" className="link">
            Privacy Policy
          </Link>
          .
        </p>
      )}
    </section>
  );
}
