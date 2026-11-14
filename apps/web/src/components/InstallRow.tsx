import { useInstall } from '../lib/install';

/** The Settings row for putting the app on the home screen. Absent when not possible or done. */
export function InstallRow() {
  const { install, ios } = useInstall();
  if (!install && !ios) return null;
  return (
    <section className="settings-sec" aria-labelledby="set-install">
      <h3 id="set-install" className="sheet-h">
        Install app
      </h3>
      {install ? (
        <>
          <p className="hint">
            Open Signal Radar from your home screen, full screen, like any app.
          </p>
          <div className="auth-actions">
            <button type="button" className="btn" onClick={install}>
              Install app
            </button>
          </div>
        </>
      ) : (
        <p className="hint">
          Tap Share in Safari, then Add to Home Screen. You can also get push alerts once it is
          installed.
        </p>
      )}
    </section>
  );
}
