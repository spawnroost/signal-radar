import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNow } from '../hooks';
import { ApiError } from '../lib/api';
import { refreshMe } from '../lib/me';
import { navigate } from '../lib/route';
import {
  deleteSave,
  fetchSave,
  parseTagInput,
  patchSave,
  saveMeta,
  type SavedItem,
} from '../lib/saves';
import { ItemActions } from './ItemActions';
import { Link } from './Link';
import { ReaderSkeleton } from './Skeletons';

type Load = 'loading' | 'ready' | 'missing' | 'error';

/** One saved page in a clean reader view. The HTML was sanitized on the server before it was stored. */
export function SavedReader({ id }: { id: string }) {
  const [item, setItem] = useState<SavedItem | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [error, setError] = useState('');
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const now = useNow();

  const run = useCallback(
    async (signal: { stale: boolean }) => {
      setLoad('loading');
      try {
        const next = await fetchSave(id);
        if (signal.stale) return;
        setItem(next);
        setLoad('ready');
      } catch (e) {
        if (signal.stale) return;
        if (e instanceof ApiError && e.status === 404) setLoad('missing');
        else {
          if (e instanceof ApiError && e.status === 401) void refreshMe();
          setError(e instanceof Error ? e.message : String(e));
          setLoad('error');
        }
      }
    },
    [id],
  );

  useEffect(() => {
    const signal = { stale: false };
    setItem(null);
    void run(signal);
    return () => {
      signal.stale = true;
    };
  }, [run]);

  const change = async (body: { archived?: boolean; favorite?: boolean; tags?: string[] }) => {
    if (!item || busy) return;
    setBusy(true);
    setError('');
    try {
      // The list answer leaves the content out; keep what is on screen.
      const next = await patchSave(item.id, body);
      setItem({ ...next, content: item.content ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that change.');
    } finally {
      setBusy(false);
    }
  };

  const addTags = (e: FormEvent) => {
    e.preventDefault();
    if (!item) return;
    const fresh = parseTagInput(tagText, item.tags);
    setTagText('');
    if (fresh.length > 0) void change({ tags: [...item.tags, ...fresh] });
  };

  const remove = async () => {
    if (!item || busy) return;
    setBusy(true);
    try {
      await deleteSave(item.id);
      navigate('/saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that.');
      setConfirm(false);
      setBusy(false);
    }
  };

  const back = (
    <p className="reader-back">
      <Link to="saved" className="link-quiet">
        <span aria-hidden="true">&larr;</span> Saved
      </Link>
    </p>
  );

  if (load === 'loading') {
    return (
      <section className="reader" aria-busy="true">
        {back}
        <ReaderSkeleton />
      </section>
    );
  }
  if (load === 'missing' || load === 'error' || !item) {
    return (
      <section>
        {back}
        <div className="state" role={load === 'error' ? 'alert' : undefined}>
          <h2 className="state-title">
            {load === 'missing' ? 'That page is not in your saved list' : 'The page did not load'}
          </h2>
          <p>
            {load === 'missing' ? (
              'It may have been deleted.'
            ) : (
              <button type="button" className="link" onClick={() => void run({ stale: false })}>
                Try again
              </button>
            )}
          </p>
          {load === 'error' && <p className="meta">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <article className="reader" aria-labelledby="reader-title">
      {back}
      <header className="reader-head">
        <h2 id="reader-title" className="reader-title">
          {item.title}
        </h2>
        <p className="meta">{saveMeta(item, now)}</p>
        <div className="item-actions reader-actions">
          <button
            type="button"
            className="link-quiet"
            disabled={busy}
            onClick={() => void change({ archived: !item.archived })}
          >
            {item.archived ? 'Move back to Unread' : 'Archive'}
          </button>
          <button
            type="button"
            className="link-quiet"
            aria-pressed={item.favorite}
            disabled={busy}
            onClick={() => void change({ favorite: !item.favorite })}
          >
            {item.favorite ? 'Favorited' : 'Favorite'}
          </button>
          {confirm ? (
            <span className="confirm" role="group" aria-label="Delete this page?">
              <button
                type="button"
                className="link-quiet confirm-yes"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete for good
              </button>
              <button type="button" className="link-quiet" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="link-quiet" onClick={() => setConfirm(true)}>
              Delete
            </button>
          )}
          <a className="link-quiet" href={item.url} rel="noopener noreferrer" target="_blank">
            Open original
          </a>
        </div>
        <ItemActions url={item.url} title={item.title} />
        <div className="reader-tags">
          {item.tags.map((t) => (
            <span key={t} className="tag tag-edit">
              {t}
              <button
                type="button"
                className="tag-x"
                disabled={busy}
                aria-label={`Remove tag ${t}`}
                onClick={() => void change({ tags: item.tags.filter((x) => x !== t) })}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </span>
          ))}
          <form className="tag-form" onSubmit={addTags}>
            <label className="sr-only" htmlFor="tag-input">
              Add tags, separated by commas
            </label>
            <input
              id="tag-input"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              maxLength={120}
              placeholder={item.tags.length ? 'Add a tag' : 'Add tags, comma separated'}
              value={tagText}
              disabled={busy}
              onChange={(e) => setTagText(e.target.value)}
            />
          </form>
        </div>
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
      </header>

      {item.content ? (
        <div className="reader-body" dangerouslySetInnerHTML={{ __html: item.content }} />
      ) : (
        <div className="reader-body reader-body-empty">
          {item.excerpt && <p>{item.excerpt}</p>}
          <p className="meta">
            We could not pull a readable version of this page. It may need a login, or build itself
            with script.{' '}
            <a className="link" href={item.url} rel="noopener noreferrer" target="_blank">
              Open the original
            </a>
            .
          </p>
        </div>
      )}
    </article>
  );
}
