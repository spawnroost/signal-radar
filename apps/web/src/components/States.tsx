interface EmptyProps {
  topic: boolean;
  source: boolean;
  /** No topics are chosen ("show everything"), so an empty feed means nothing has arrived yet. */
  noTopics?: boolean;
  onCustomize: () => void;
  onClearFilter: () => void;
}

export function EmptyState({
  topic,
  source,
  noTopics = false,
  onCustomize,
  onClearFilter,
}: EmptyProps) {
  const filtered = topic || source;
  return (
    <div className="state">
      <h2 className="state-title">Nothing here yet</h2>
      <p>
        {topic
          ? 'No stories in the feed match this topic right now.'
          : source
            ? 'No stories from the sources you picked right now.'
            : noTopics
              ? 'The first stories are on their way. The radar checks sources twice a day.'
              : 'No stories match your topics right now.'}{' '}
        {filtered && (
          <>
            <button type="button" className="link" onClick={onClearFilter}>
              Show all stories
            </button>{' '}
            or{' '}
          </>
        )}
        <button type="button" className="link" onClick={onCustomize}>
          {filtered ? 'change your topics' : noTopics ? 'Choose topics' : 'Change your topics'}
        </button>
        .
      </p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="state" role="alert">
      <h2 className="state-title">The feed did not load</h2>
      <p>
        The server did not answer, and there is no saved copy to show yet.{' '}
        <button type="button" className="link" onClick={onRetry}>
          Try again
        </button>
      </p>
      <p className="meta">{message}</p>
    </div>
  );
}
