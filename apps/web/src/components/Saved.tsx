import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RadarArcs } from '../icons';
import { useNow } from '../hooks';
import { ApiError } from '../lib/api';
import { refreshMe } from '../lib/me';
import { navigate, savedHref } from '../lib/route';
import {
  bookmarklet,
  deleteSave,
  fetchSaves,
  fetchSaveTags,
  patchSave,
  saveLink,
  saveMeta,
  toSaveUrl,
  type SavedItem,
  type SaveState,
} from '../lib/saves';
import { ListSkeleton } from './Skeletons';
import { Tabs } from './Tabs';

const TABS: { id: SaveState; label: string }[] = [
  { id: 'unread', label: 'Unread' },
  { id: 'archived', label: 'Archived' },
];

type Load = 'loading' | 'ready' | 'more' | 'error';

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

/** The bookmarklet and share-sheet how-to. It is the empty state, and a quiet fold below the list. */
export function SaveFromAnywhere() {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <div className="save-how">
      <p>
        <strong>Bookmarklet.</strong> Drag{' '}
        {/* React will not render a javascript: href, so it is set on the element itself */}
        <a
          className="bookmarklet"
          href="#save-bookmarklet"
          ref={(el) => el?.setAttribute('href', bookmarklet(origin))}
          onClick={(e) => e.preventDefault()}
        >
          Save to Signal Radar
        </a>{' '}
        to your bookmarks bar. Click it on any page to save that page.
      </p>
      <p>
        <strong>Share sheet.</strong> Install Signal Radar to your home screen (Add to Home Screen
        on iPhone, Install on Android and desktop Chrome), then choose it from the share menu in any
        app or browser.
      </p>
    </div>
  );
}

export function Saved() {
  const [state, setState] = useState<SaveState>('unread');
  const [tag, setTag] = useState<string | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<{ kind: 'done' | 'error'; text: string } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const now = useNow();
  const toastId = useRef(0);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) void refreshMe();
    setError(e instanceof Error ? e.message : String(e));
  }, []);

  const loadTags = useCallback(
    async (signal: { stale: boolean }) => {
      try {
        const next = await fetchSaveTags(state);
        if (!signal.stale) setTags(next);
      } catch {
        /* the filter row is optional */
      }
    },
    [state],
  );

  const loadPage = useCallback(
    async (cursor: string | null, signal: { stale: boolean }) => {
      setLoad(cursor ? 'more' : 'loading');
      try {
        const page = await fetchSaves(state, tag, cursor);
        if (signal.stale) return;
        setItems((cur) => {
          if (!cursor) return page.items;
          const known = new Set(cur.map((i) => i.id));
          return [...cur, ...page.items.filter((i) => !known.has(i.id))];
        });
        setNextCursor(page.nextCursor);
        setLoad('ready');
      } catch (e) {
        if (signal.stale) return;
        fail(e);
        setLoad('error');
      }
    },
    [state, tag, fail],
  );

  useEffect(() => {
    const signal = { stale: false };
    setItems([]);
    setNextCursor(null);
    setToast(null);
    setConfirming(null);
    void loadPage(null, signal);
    return () => {
      signal.stale = true;
    };
  }, [loadPage]);

  useEffect(() => {
    const signal = { stale: false };
    void loadTags(signal);
    return () => {
      signal.stale = true;
    };
  }, [loadTags]);

  // A tag that no longer has any saves in this tab stops being a filter.
  useEffect(() => {
    if (tag && load === 'ready' && items.length === 0 && !tags.some((t) => t.tag === tag)) {
      setTag(null);
    }
  }, [tag, tags, items.length, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const say = (message: string, undo?: () => void) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message, ...(undo ? { undo } : {}) });
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (adding) return;
    const url = toSaveUrl(link);
    if (!url) {
      setNote({
        kind: 'error',
        text: 'That does not look like a web link. Paste the full address.',
      });
      return;
    }
    setAdding(true);
    setNote(null);
    try {
      const { item, created } = await saveLink(url);
      setLink('');
      if (item.archived) {
        setNote({ kind: 'done', text: 'Already saved, in Archived.' });
      } else {
        if (state !== 'unread') setState('unread');
        else setItems((cur) => [item, ...cur.filter((i) => i.id !== item.id)]);
        setNote({ kind: 'done', text: created ? 'Saved.' : 'Already saved.' });
        void loadTags({ stale: false });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) void refreshMe();
      setNote({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Could not save that link.',
      });
    } finally {
      setAdding(false);
    }
  };

  const setArchived = async (item: SavedItem, archived: boolean) => {
    const index = items.findIndex((i) => i.id === item.id);
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    const back = async () => {
      setToast(null);
      try {
        await patchSave(item.id, { archived: !archived });
        setItems((cur) => {
          if (cur.some((i) => i.id === item.id)) return cur;
          const next = [...cur];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
          return next;
        });
        void loadTags({ stale: false });
      } catch (e) {
        fail(e);
        say('Could not undo that. Try again in a moment.');
      }
    };
    say(archived ? 'Archived.' : 'Moved back to Unread.', () => void back());
    try {
      await patchSave(item.id, { archived });
      void loadTags({ stale: false });
    } catch (e) {
      setItems((cur) => {
        const next = [...cur];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
        return next;
      });
      fail(e);
      say('Could not save that. The page is back where it was.');
    }
  };

  const remove = async (item: SavedItem) => {
    setConfirming(null);
    const index = items.findIndex((i) => i.id === item.id);
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    try {
      await deleteSave(item.id);
      say('Deleted.');
      void loadTags({ stale: false });
    } catch (e) {
      setItems((cur) => {
        const next = [...cur];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
        return next;
      });
      fail(e);
      say('Could not delete that. It is still saved.');
    }
  };

  const openItem = (id: string) => navigate(savedHref(id));
  const empty = (load === 'ready' || load === 'more') && items.length === 0;

  return (
    <section aria-labelledby="saved-title">
      <div className="arcs-host">
        <RadarArcs className="head-arcs" />
        <div className="page-head">
          <h2 id="saved-title" className="page-title">
            Saved
          </h2>
        </div>
        <p className="lede queue-lede">
          Links you want to read later, kept in a clean reader view. Tag them, archive what you have
          read, and summarize any of them.
        </p>
      </div>
      <form className="field addlink" onSubmit={(e) => void add(e)} noValidate>
        <label className="field-label" htmlFor="save-input">
          Save a link
        </label>
        <div className="field-row">
          <input
            id="save-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://"
            value={link}
            disabled={adding}
            aria-invalid={note?.kind === 'error' || undefined}
            aria-describedby="save-note"
            onChange={(e) => {
              setLink(e.target.value);
              if (note?.kind === 'error') setNote(null);
            }}
          />
          <button type="submit" className="btn" disabled={adding || !link.trim()}>
            {adding ? 'Saving' : 'Save'}
          </button>
        </div>
        <p
          id="save-note"
          className={note?.kind === 'error' ? 'addlink-note warn' : 'addlink-note'}
          role={note?.kind === 'error' ? 'alert' : 'status'}
        >
          {adding ? 'Reading the page…' : (note?.text ?? 'Any public article, post or page.')}
        </p>
      </form>

      <Tabs
        tabs={TABS}
        active={state}
        onChange={(id) => {
          setState(id as SaveState);
          setTag(null);
        }}
        label="Saved pages"
        panelId="saved-panel"
        idPrefix="sstate"
      />
      {tags.length > 0 && (
        <div className="tagbar" role="group" aria-label="Filter by tag">
          {tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              className="chip"
              data-active={t.tag === tag || undefined}
              aria-pressed={t.tag === tag}
              onClick={() => setTag(t.tag === tag ? null : t.tag)}
            >
              <span className="chip-label">{t.tag}</span>
              <span className="chip-count">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      <div id="saved-panel" role="tabpanel" aria-labelledby={`sstate-${state}`} className="qpanel">
        {load === 'loading' && <ListSkeleton kind="srow" />}

        {load === 'error' && (
          <div className="state" role="alert">
            <h2 className="state-title">Your saved pages did not load</h2>
            <p>
              <button
                type="button"
                className="link"
                onClick={() => void loadPage(null, { stale: false })}
              >
                Try again
              </button>
            </p>
            <p className="meta">{error}</p>
          </div>
        )}

        {empty &&
          (state === 'unread' && !tag ? (
            <div className="state">
              <RadarArcs className="state-arcs" />
              <h2 className="state-title">Nothing saved yet</h2>
              <p>
                Paste a link above, or save pages as you browse. Below, the bookmarklet and share
                sheet show how to save from anywhere.
              </p>
            </div>
          ) : (
            <div className="state">
              <RadarArcs className="state-arcs" />
              <h2 className="state-title">{tag ? `Nothing tagged ${tag}` : 'Nothing archived'}</h2>
              <p>
                {tag
                  ? 'Pages you tag show up here.'
                  : 'Pages you archive wait here, out of the way, until you want them again.'}
              </p>
            </div>
          ))}

        {items.length > 0 && (
          <ol className="items">
            {items.map((item) => (
              <li key={item.id} className="srow">
                <div className="srow-main">
                  <h3 className="item-title">
                    <a
                      href={savedHref(item.id)}
                      onClick={(e) => {
                        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                          return;
                        e.preventDefault();
                        openItem(item.id);
                      }}
                    >
                      {item.title}
                    </a>
                  </h3>
                  <p className="meta">{saveMeta(item, now)}</p>
                  {item.excerpt && <p className="srow-excerpt">{item.excerpt}</p>}
                  {item.tags.length > 0 && (
                    <p className="srow-tags">
                      {item.tags.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="tag"
                          onClick={() => setTag(t)}
                          aria-label={`Show pages tagged ${t}`}
                        >
                          {t}
                        </button>
                      ))}
                    </p>
                  )}
                  <div className="item-actions">
                    <button
                      type="button"
                      className="link-quiet"
                      aria-label={`${item.archived ? 'Move back to Unread' : 'Archive'}. ${item.title}`}
                      onClick={() => void setArchived(item, !item.archived)}
                    >
                      {item.archived ? 'Unarchive' : 'Archive'}
                    </button>
                    {confirming === item.id ? (
                      <span className="confirm" role="group" aria-label="Delete this page?">
                        <button
                          type="button"
                          className="link-quiet confirm-yes"
                          onClick={() => void remove(item)}
                        >
                          Delete for good
                        </button>
                        <button
                          type="button"
                          className="link-quiet"
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="link-quiet"
                        aria-label={`Delete. ${item.title}`}
                        onClick={() => setConfirming(item.id)}
                      >
                        Delete
                      </button>
                    )}
                    <a
                      className="link-quiet"
                      href={item.url}
                      rel="noopener noreferrer"
                      target="_blank"
                      aria-label={`Open the original. ${item.title}`}
                    >
                      Original
                    </a>
                  </div>
                </div>
                {item.imageUrl && (
                  <img
                    className="srow-thumb"
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(e) => e.currentTarget.remove()}
                  />
                )}
              </li>
            ))}
          </ol>
        )}

        {nextCursor && (load === 'ready' || load === 'more') && (
          <div className="more">
            <button
              type="button"
              className="btn"
              disabled={load === 'more'}
              onClick={() => void loadPage(nextCursor, { stale: false })}
            >
              {load === 'more' ? 'Loading' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {(load === 'ready' || load === 'more') && (
        <details className="save-fold">
          <summary>Save from anywhere</summary>
          <SaveFromAnywhere />
        </details>
      )}

      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.undo && (
              <button type="button" className="toast-btn" onClick={toast.undo}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
