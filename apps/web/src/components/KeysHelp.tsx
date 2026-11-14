import { useEffect, useRef, useState } from 'react';

const KEYS: { keys: string[]; label: string }[] = [
  { keys: ['j', 'k'], label: 'Move down, up' },
  { keys: ['p'], label: 'Pick' },
  { keys: ['s'], label: 'Skip' },
  { keys: ['u'], label: 'Undo' },
];

/** The keyboard shortcuts of the Ideas queue, in a popover that closes on Escape or an outside tap. */
export function KeysHelp() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      summary.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <details
      className="keys"
      ref={root}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary ref={summary}>Keys</summary>
      <dl className="keys-pop">
        {KEYS.map((k) => (
          <div key={k.label} className="keys-row">
            <dt>
              {k.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{k.label}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
