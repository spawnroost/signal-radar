import { useEffect, useRef, useState } from 'react';
import type { Pass } from '@radar/core/passes';
import { CloseIcon } from '../icons';
import { refreshMe } from '../lib/me';
import { durationLabel, formatMoney } from '../lib/passes';
import {
  checkUtr,
  fetchUpiLink,
  refreshPending,
  submitError,
  submitUtr,
  UTR_HINT,
} from '../lib/upi';
import type { UpiLink } from '../lib/upi';

type Load =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; pay: UpiLink };

/** The pay sheet: open the UPI app (or scan the QR), then send the 12-digit reference. */
export function UpiPay({ pass, onClose }: { pass: Pass | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = pass !== null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet sheet-small"
      aria-labelledby="upi-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current) onClose();
      }}
    >
      {pass && <Body key={pass.id} pass={pass} onClose={onClose} />}
    </dialog>
  );
}

function Body({ pass, onClose }: { pass: Pass; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    fetchUpiLink(pass.id)
      .then((pay) => live && setLoad({ status: 'ready', pay }))
      .catch((e: unknown) => {
        if (live) {
          setLoad({
            status: 'error',
            message: e instanceof Error ? e.message : 'Could not load the payment details.',
          });
        }
      });
    return () => {
      live = false;
    };
  }, [pass.id, attempt]);

  // On a short phone screen the message lands under the keyboard or the footer; bring it up.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  const link = load.status === 'ready' ? load.pay.link : '';
  useEffect(() => {
    if (!link) return;
    let live = true;
    // Rendered here in the browser; the link never goes to a QR service. Loaded on demand.
    import('qrcode')
      .then((m) => m.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }))
      .then((svg) => live && setQr(svg))
      .catch(() => live && setQr(''));
    return () => {
      live = false;
    };
  }, [link]);

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        /* no clipboard: the ID is selectable on its own */
      });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const checked = checkUtr(raw);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await submitUtr(pass.id, checked.utr);
      setSent(true);
      void refreshPending();
      void refreshMe();
    } catch (err) {
      setError(submitError(err));
    } finally {
      setBusy(false);
    }
  };

  const length = durationLabel(pass.days);

  return (
    <div className="sheet-inner">
      <div className="sheet-head">
        <h2 id="upi-title" className="sheet-title">
          {sent ? 'Payment sent' : 'Pay with UPI'}
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>

      {sent ? (
        <>
          <div className="upi-body">
            <p role="status">Sent. We will approve it shortly, usually within a few hours.</p>
            <p className="hint">
              You can close this. Your {length} are added to Pro as soon as it is approved.
            </p>
          </div>
          <div className="sheet-foot upi-foot">
            <button type="button" className="btn btn-solid" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="upi-body">
            <div className="upi-sum">
              <span className="upi-sum-price">{formatMoney(pass.inr, 'INR')}</span>
              <span className="upi-sum-what">{length} of Pro</span>
            </div>

            {load.status === 'loading' && (
              <p className="hint" role="status">
                One moment
              </p>
            )}
            {load.status === 'error' && (
              <div role="alert">
                <p className="warn">{load.message}</p>
                <button type="button" className="text-btn" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>
              </div>
            )}

            {load.status === 'ready' && (
              <>
                <a className="btn btn-solid upi-open" href={load.pay.link}>
                  Open UPI app
                </a>

                <button
                  type="button"
                  className="text-btn upi-qr-toggle"
                  aria-expanded={showQr}
                  aria-controls="upi-qr"
                  onClick={() => setShowQr((v) => !v)}
                >
                  {showQr ? 'Hide QR' : 'Show QR'}
                </button>
                <div id="upi-qr" className="upi-qr" data-open={showQr || undefined}>
                  {qr ? (
                    <div
                      className="upi-qr-box"
                      role="img"
                      aria-label={`QR code to pay ${formatMoney(pass.inr, 'INR')} by UPI`}
                      dangerouslySetInnerHTML={{ __html: qr }}
                    />
                  ) : (
                    <div className="upi-qr-box upi-qr-wait" aria-hidden="true" />
                  )}
                  <p className="upi-hint">Scan it with any UPI app.</p>
                </div>

                <div className="upi-vpa">
                  <div className="upi-vpa-text">
                    <span className="field-label">UPI ID</span>
                    <span className="upi-vpa-id">{load.pay.vpa}</span>
                  </div>
                  <button type="button" className="btn" onClick={() => copy(load.pay.vpa)}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="hint upi-vpa-note">
                  If you type the amount yourself, send exactly {formatMoney(pass.inr, 'INR')}.
                </p>

                <form id="upi-form" className="upi-form" onSubmit={submit} noValidate>
                  <p className="upi-step">
                    After paying, enter the 12-digit UTR from your UPI app.
                  </p>
                  <label className="field">
                    <span className="field-label">UTR (reference number)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="send"
                      maxLength={24}
                      placeholder={UTR_HINT}
                      value={raw}
                      aria-describedby={error ? 'upi-error' : undefined}
                      onChange={(e) => {
                        setRaw(e.target.value);
                        if (error) setError('');
                      }}
                    />
                  </label>
                  {error && (
                    <p id="upi-error" ref={errorRef} className="warn" role="alert">
                      {error}
                    </p>
                  )}
                </form>
              </>
            )}
          </div>

          <div className="sheet-foot upi-foot">
            <button
              type="submit"
              form="upi-form"
              className="btn btn-solid"
              disabled={load.status !== 'ready' || busy}
            >
              {busy ? 'Sending' : 'I have paid'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
