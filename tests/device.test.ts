import { describe, expect, it } from 'vitest';
import { backupReminder, BACKUP_SNOOZE_DAYS, isIOSDevice, requestPersistentStorage, snoozeUntil, storageProtection } from '../src/lib/device';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 19);

describe('isIOSDevice', () => {
  it('detects iPhone and iPad', () => {
    expect(isIOSDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isIOSDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5)).toBe(true);
  });
  it('detects iPadOS, which reports itself as a Mac with a touch screen', () => {
    expect(isIOSDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
  });
  it('ignores desktops and Android', () => {
    expect(isIOSDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isIOSDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0)).toBe(false);
    expect(isIOSDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5)).toBe(false);
  });
});

describe('backupReminder', () => {
  it('stays quiet until there is data', () => {
    expect(backupReminder({ hasData: false, now: NOW })).toBeNull();
  });
  it('reminds when there has never been a backup', () => {
    expect(backupReminder({ hasData: true, now: NOW })).toBe('never');
  });
  it('reminds when the last backup is over 30 days old', () => {
    expect(backupReminder({ hasData: true, lastBackupAt: NOW - 31 * DAY, now: NOW })).toBe('stale');
    expect(backupReminder({ hasData: true, lastBackupAt: NOW - 29 * DAY, now: NOW })).toBeNull();
  });
  it('respects a snooze until it runs out', () => {
    const snoozed = snoozeUntil(NOW);
    expect(snoozed - NOW).toBe(BACKUP_SNOOZE_DAYS * DAY);
    expect(backupReminder({ hasData: true, snoozedUntil: snoozed, now: NOW + DAY })).toBeNull();
    expect(backupReminder({ hasData: true, snoozedUntil: snoozed, now: snoozed + 1 })).toBe('never');
  });
});

const fakeStorage = (persisted: boolean, grant: boolean) => {
  const calls = { persist: 0 };
  const storage = {
    persisted: async () => persisted,
    persist: async () => { calls.persist++; return grant; },
  } as unknown as StorageManager;
  return { storage, calls };
};

describe('persistent storage', () => {
  it('does not ask again when already persisted', async () => {
    const { storage, calls } = fakeStorage(true, true);
    expect(await requestPersistentStorage(storage)).toBe('persisted');
    expect(calls.persist).toBe(0);
  });
  it('asks, and reports whether the browser granted it', async () => {
    expect(await requestPersistentStorage(fakeStorage(false, true).storage)).toBe('persisted');
    expect(await requestPersistentStorage(fakeStorage(false, false).storage)).toBe('not-granted');
  });
  it('handles browsers without the Storage API', async () => {
    expect(await requestPersistentStorage({} as StorageManager)).toBe('unsupported');
    expect(await storageProtection({} as StorageManager)).toBe('unsupported');
  });
  it('reports the current state without asking', async () => {
    const { storage, calls } = fakeStorage(false, true);
    expect(await storageProtection(storage)).toBe('not-granted');
    expect(calls.persist).toBe(0);
  });
});
