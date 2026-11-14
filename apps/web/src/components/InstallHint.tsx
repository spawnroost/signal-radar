import { useEffect, useState } from 'react';
import { CloseIcon } from '../icons';
import {
  countVisit,
  dismissInstallHint,
  installHintDismissed,
  shouldShowInstallHint,
  useInstall,
} from '../lib/install';

/**
 * A small, one-time card for the second visit onward: keep the radar on the home screen. It floats
 * over the corner instead of pushing the page down, and one tap on either button retires it.
 */
export function InstallHint() {
  const { install, ios } = useInstall();
  const [visits] = useState(countVisit);
  const [dismissed, setDismissed] = useState(installHintDismissed);

  const show = shouldShowInstallHint({ visits, dismissed, installable: install !== null || ios });

  // The card floats, so the page keeps room under its last line for as long as it is up.
  useEffect(() => {
    if (!show) return;
    document.documentElement.dataset.installHint = '';
    return () => {
      delete document.documentElement.dataset.installHint;
    };
  }, [show]);

  if (!show) return null;
  const done = () => {
    dismissInstallHint();
    setDismissed(true);
  };

  return (
    <aside className="install-hint" aria-label="Install Signal Radar">
      <p className="install-hint-text">
        {install
          ? 'Keep Signal Radar on your home screen for one-tap access.'
          : 'To keep Signal Radar on your home screen, tap Share, then Add to Home Screen.'}
      </p>
      <div className="install-hint-actions">
        {install && (
          <button
            type="button"
            className="btn btn-solid"
            onClick={() => {
              install();
              done();
            }}
          >
            Install
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={done}>
          <CloseIcon />
        </button>
      </div>
    </aside>
  );
}
