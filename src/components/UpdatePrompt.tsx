import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from './Toast';

const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Registers the service worker (offline support) and offers new versions.
 * A new version is downloaded in the background and waits until the user clicks Reload,
 * so an update never swaps the app out from under someone mid-edit.
 */
export function UpdatePrompt() {
  const toast = useToast();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Tabs and installed apps can stay open for days: look for a new version every hour.
      if (registration) setInterval(() => void registration.update().catch(() => {}), CHECK_EVERY_MS);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    toast('The Grimoire is ready to work offline', 'success');
    setOfflineReady(false);
  }, [offlineReady, setOfflineReady, toast]);

  if (!needRefresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>A new version of The Grimoire is available.</span>
      <button className="btn btn-sm btn-primary" onClick={() => void updateServiceWorker(true)}>Reload</button>
      <button className="btn btn-sm" onClick={() => setNeedRefresh(false)}>Later</button>
    </div>
  );
}
