import { useEffect, useRef, useState } from 'react';
import { collectionT, decksT, useSettings, useSettingsLoaded, watchT } from '../lib/store';
import {
  backupReminder, backupSnoozedUntil, dismissIosHint, iosHintDismissed, isIOSBrowserTab, requestPersistentStorage, snoozeBackupReminder,
} from '../lib/device';
import { BackupModal, type BackupTab } from './BackupModal';

/**
 * Keeps saved data safe app-wide:
 * - asks the browser to protect this site's storage once there is something worth keeping;
 * - on iPhone/iPad in a Safari tab, explains installing to the home screen (and that the installed
 *   app has its own, separate data);
 * - reminds about backups when there has never been one or the last is over a month old.
 */
export function DataSafety() {
  const decks = decksT.useAll();
  const items = collectionT.useAll();
  const watch = watchT.useAll();
  // Every hook runs on every render (no short-circuit), then combine.
  const loadedFlags = [decksT.useLoaded(), collectionT.useLoaded(), watchT.useLoaded(), useSettingsLoaded()];
  const loaded = loadedFlags.every(Boolean);
  const { lastBackupAt } = useSettings();
  const hasData = decks.length > 0 || items.length > 0 || watch.length > 0;

  const [modal, setModal] = useState<BackupTab | null>(null);
  const [iosHint, setIosHint] = useState(() => isIOSBrowserTab() && !iosHintDismissed());
  const [snoozedUntil, setSnoozedUntil] = useState(backupSnoozedUntil);

  const asked = useRef(false);
  useEffect(() => {
    if (!hasData || asked.current) return;
    asked.current = true;
    void requestPersistentStorage();
  }, [hasData]);

  const reminder = loaded ? backupReminder({ hasData, lastBackupAt, snoozedUntil, now: Date.now() }) : null;

  let banner = null;
  if (loaded && iosHint) {
    const close = () => { dismissIosHint(); setIosHint(false); };
    banner = (
      <div className="banner global-banner" role="note">
        <span>
          <b>On iPhone or iPad, install The Grimoire:</b> tap <b>Share</b>, then <b>Add to Home Screen</b>. Safari can clear a
          website's data after 7 days without a visit; the installed app keeps it.{' '}
          {hasData
            ? 'The installed app has its own storage, separate from Safari: make a backup here, then restore it in the app.'
            : 'Install before adding anything: the installed app has its own storage, separate from Safari.'}
        </span>
        <span className="banner-actions">
          {hasData && <button className="btn btn-sm btn-primary" onClick={() => setModal('backup')}>Back up now</button>}
          <button className="btn btn-sm" onClick={close}>Got it</button>
        </span>
      </div>
    );
  } else if (reminder) {
    banner = (
      <div className="banner global-banner" role="note">
        <span>
          Your decks and collection are saved only in this browser.{' '}
          {reminder === 'never' ? 'You haven’t made a backup yet.' : 'It’s been over a month since your last backup.'}
        </span>
        <span className="banner-actions">
          <button className="btn btn-sm btn-primary" onClick={() => setModal('backup')}>Back up now</button>
          <button className="btn btn-sm" onClick={() => { snoozeBackupReminder(); setSnoozedUntil(backupSnoozedUntil()); }}>Remind me in a week</button>
        </span>
      </div>
    );
  }

  return (
    <>
      {banner}
      {modal && <BackupModal initialTab={modal} onClose={() => setModal(null)} />}
    </>
  );
}
