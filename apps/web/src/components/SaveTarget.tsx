import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { setGateNext } from '../lib/gate';
import { refreshMe, type MeState } from '../lib/me';
import { navigate, savedHref, useSearchString } from '../lib/route';
import {
  clearPendingSave,
  rememberPendingSave,
  saveLink,
  sharedUrl,
  type SavedItem,
} from '../lib/saves';
import { domainOf } from '../lib/format';
import { Link } from './Link';
import { PageSkeleton } from './Skeletons';

type Phase =
  | { kind: 'saving' }
  | { kind: 'done'; item: SavedItem; created: boolean }
  | { kind: 'error'; message: string };

/**
 * `/save?url=…`: where the PWA share sheet and the bookmarklet land. It pulls the link out of the
 * request, saves it and shows the result. Signed out, it keeps the link and asks for a sign-in
 * that returns here.
 */
export function SaveTarget({ me }: { me: MeState }) {
  const search = useSearchString();
  const url = sharedUrl(new URLSearchParams(search));
  const [phase, setPhase] = useState<Phase>({ kind: 'saving' });
  const started = useRef<string | null>(null);
  const signedIn = me.status === 'ready';
  const anon = me.status === 'anon';

  useEffect(() => {
    if (anon && url) rememberPendingSave(localStorage, url);
  }, [anon, url]);

  const attempt = (u: string) => {
    setPhase({ kind: 'saving' });
    saveLink(u).then(
      (r) => setPhase({ kind: 'done', ...r }),
      (e: unknown) => {
        if (e instanceof ApiError && e.status === 401) void refreshMe();
        setPhase({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Could not save that link.',
        });
      },
    );
  };

  useEffect(() => {
    if (!signedIn || !url || started.current === url) return;
    started.current = url;
    clearPendingSave(localStorage);
    attempt(url);
    // `attempt` only sets state; the effect is keyed on the link and the session
  }, [signedIn, url]);

  if (!url) {
    return (
      <div className="state">
        <h2 className="state-title">No link to save</h2>
        <p>
          This page saves a link sent from your share sheet or the bookmarklet. Nothing came with
          this visit.
        </p>
        <div className="auth-actions">
          <Link to="saved" className="btn btn-solid">
            Open Saved
          </Link>
        </div>
      </div>
    );
  }

  if (me.status === 'loading') {
    return (
      <div className="state" aria-busy="true">
        <PageSkeleton />
      </div>
    );
  }
  if (me.status === 'error') {
    return (
      <div className="state" role="alert">
        <h2 className="state-title">Could not check your session</h2>
        <p>The server did not answer. Reload the page to try again.</p>
        <p className="meta">{me.message}</p>
      </div>
    );
  }

  if (anon) {
    const back = location.pathname + location.search;
    return (
      <div className="state">
        <h2 className="state-title">Sign in to save this link</h2>
        <p>
          <span className="mono-inline">{domainOf(url) || url}</span> is waiting. Sign in or create
          a free account and it is saved for you.
        </p>
        <div className="auth-actions">
          <Link to="signin" className="btn btn-solid" onClick={() => setGateNext(back)}>
            Sign in
          </Link>
          <Link to="signin" signup className="link" onClick={() => setGateNext(back)}>
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  if (phase.kind === 'saving') {
    return (
      <div className="state" aria-busy="true" role="status">
        <h2 className="state-title">Saving</h2>
        <p className="meta">Reading {domainOf(url) || 'the page'}</p>
      </div>
    );
  }
  if (phase.kind === 'error') {
    return (
      <div className="state" role="alert">
        <h2 className="state-title">Could not save that link</h2>
        <p>{phase.message}</p>
        <div className="auth-actions">
          <button type="button" className="btn" onClick={() => attempt(url)}>
            Try again
          </button>
          <Link to="saved" className="link">
            Open Saved
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="state" role="status">
      <h2 className="state-title">{phase.created ? 'Saved' : 'Already saved'}</h2>
      <p>{phase.item.title}</p>
      <div className="auth-actions">
        <a
          className="btn btn-solid"
          href={savedHref(phase.item.id)}
          onClick={(e) => {
            e.preventDefault();
            navigate(savedHref(phase.item.id));
          }}
        >
          Read it
        </a>
        <Link to="saved" className="link">
          Open Saved
        </Link>
      </div>
    </div>
  );
}
