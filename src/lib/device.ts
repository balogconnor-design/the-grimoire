// Facts about the browser/device the app is running in, and the data-safety rules built on them.
// The pure functions take their inputs as arguments so they can be unit-tested without a browser.

const DAY = 24 * 60 * 60 * 1000;
export const BACKUP_STALE_DAYS = 30;
export const BACKUP_SNOOZE_DAYS = 7;

/** The portable launcher serves the app on this port (see portable/Launcher.cs). */
export const PORTABLE_PORT = '47823';
export const isPortable = () => typeof window !== 'undefined' && window.location.port === PORTABLE_PORT;

/** iPhone, iPod or iPad. iPadOS reports itself as a Mac, so a Mac with a touch screen counts too. */
export function isIOSDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** Running as an installed app (home screen / desktop app window) rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** iOS in a browser tab: data there can be wiped by Safari, and isn't shared with the home-screen app. */
export function isIOSBrowserTab(): boolean {
  if (typeof navigator === 'undefined' || isPortable()) return false;
  return isIOSDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) && !isStandalone();
}

/** Phones and tablets: saving a file through the share sheet works better there than a download. */
export function prefersShareSheet(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && typeof navigator.share === 'function';
}

export type BackupReminder = 'never' | 'stale' | null;

/**
 * Whether to remind the user to back up: only once there is something worth saving, when there
 * has never been a backup or the last one is over BACKUP_STALE_DAYS old, and not while snoozed.
 */
export function backupReminder(opts: { hasData: boolean; lastBackupAt?: number; snoozedUntil?: number; now: number }): BackupReminder {
  const { hasData, lastBackupAt, snoozedUntil, now } = opts;
  if (!hasData) return null;
  if (snoozedUntil && now < snoozedUntil) return null;
  if (!lastBackupAt) return 'never';
  return now - lastBackupAt > BACKUP_STALE_DAYS * DAY ? 'stale' : null;
}

export const snoozeUntil = (now: number) => now + BACKUP_SNOOZE_DAYS * DAY;

export type StorageProtection = 'persisted' | 'not-granted' | 'unsupported';

/**
 * Ask the browser to treat this site's data as persistent, so it isn't cleared when the device
 * runs low on space (and, in Safari, isn't wiped after 7 days without a visit). Chrome and Edge
 * decide silently; Firefox may ask the user. Safe to call repeatedly.
 */
export async function requestPersistentStorage(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<StorageProtection> {
  if (!storage?.persist || !storage.persisted) return 'unsupported';
  try {
    if (await storage.persisted()) return 'persisted';
    return (await storage.persist()) ? 'persisted' : 'not-granted';
  } catch {
    return 'unsupported';
  }
}

/** Current protection state without asking for it. */
export async function storageProtection(storage: StorageManager | undefined = globalThis.navigator?.storage): Promise<StorageProtection> {
  if (!storage?.persisted) return 'unsupported';
  try {
    return (await storage.persisted()) ? 'persisted' : 'not-granted';
  } catch {
    return 'unsupported';
  }
}

// Per-browser conveniences (not part of backups): dismissed hints and snoozes.
const LS = { iosHint: 'grimoire.iosInstallHintDismissed', snooze: 'grimoire.backupReminderSnoozedUntil' };
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the hint just shows again next time */
  }
}
export const iosHintDismissed = () => lsGet(LS.iosHint) === '1';
export const dismissIosHint = () => lsSet(LS.iosHint, '1');
export const backupSnoozedUntil = () => Number(lsGet(LS.snooze)) || undefined;
export const snoozeBackupReminder = (now = Date.now()) => lsSet(LS.snooze, String(snoozeUntil(now)));
