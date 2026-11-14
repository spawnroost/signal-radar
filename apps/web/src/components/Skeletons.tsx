import type { CSSProperties } from 'react';

/**
 * Loading placeholders shaped like the content that replaces them. Each one is wrapped in
 * `skeleton-delay`, which keeps it invisible for the first 150 ms (CSS only, so it needs no state
 * and the pre-rendered pages still carry it): quick loads never flash a skeleton.
 */

export function Bar({
  width,
  height,
  short,
  style,
}: {
  width?: string | number;
  height?: number;
  short?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={short ? 'bar short' : 'bar'}
      style={{
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...style,
      }}
    />
  );
}

type RowKind = 'item' | 'qrow' | 'srow';

/** A list of story rows: numbered for Read, rank-aligned for Ideas, plain for Saved. */
export function ListSkeleton({
  count = 4,
  kind = 'item',
  numbered = false,
  delay = true,
}: {
  count?: number;
  kind?: RowKind;
  /** Show 1, 2, 3 in the rank column (the Read feed does). */
  numbered?: boolean;
  delay?: boolean;
}) {
  return (
    <ol className={delay ? 'items skeleton-delay' : 'items'} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const body = (
          <>
            <Bar width={`${88 - ((i * 13) % 30)}%`} />
            <Bar short width={`${40 + ((i * 17) % 25)}%`} />
          </>
        );
        return (
          <li key={i} className={`${kind} skeleton`}>
            {kind === 'srow' ? (
              <div className="srow-main">{body}</div>
            ) : (
              <>
                <span className="rank">{numbered ? i + 1 : ''}</span>
                <div className="item-body">{body}</div>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The saved-page reader: back link, title, meta line and a few paragraphs. */
export function ReaderSkeleton() {
  return (
    <div className="skeleton-delay" aria-hidden="true">
      <div className="reader-head">
        <Bar width="78%" height={28} />
        <Bar width="52%" height={28} />
        <Bar short width="40%" />
      </div>
      {[92, 100, 96, 70].map((w, i) => (
        <Bar key={i} width={`${w}%`} />
      ))}
    </div>
  );
}

/** A settings-style form: label and input pairs. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="form skeleton-delay" aria-hidden="true">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="field">
          <Bar short width="22%" />
          <Bar height={40} />
        </div>
      ))}
    </div>
  );
}

/** A page's title and a few lines, for screens that only wait on the session. */
export function PageSkeleton() {
  return (
    <div className="skeleton-delay" aria-hidden="true">
      <Bar width="40%" height={28} />
      <Bar short width="70%" />
      <Bar short width="55%" />
    </div>
  );
}

/** One line of status text: "Checking this device". */
export function LineSkeleton({ width = '12rem' }: { width?: string }) {
  return (
    <div className="skeleton-delay" aria-hidden="true">
      <Bar short width={width} />
    </div>
  );
}

/** The sign-in buttons, before the server says which ones are on. */
export function ProvidersSkeleton() {
  return (
    <div className="providers skeleton-delay" aria-hidden="true">
      <Bar height={48} style={{ marginTop: 0 }} />
      <Bar height={48} style={{ marginTop: 0 }} />
    </div>
  );
}
