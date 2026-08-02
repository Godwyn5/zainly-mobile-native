// ─── Notification scheduler ───────────────────────────────────────────────────
// Local-only scheduling using expo-notifications.
// No server push tokens. No backend. No Edge Functions.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { NotificationSettings } from './types';
import {
  getScheduledNotificationIds,
  saveScheduledNotificationIds,
} from './storage';

// ── Android channel ──
const CHANNEL_ID = 'zainly-hifz-reminders';

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Rappels Zainly',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 100, 200],
    lightColor: '#B8962E',
  });
}

// ── Permission ──

export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export async function getNotificationPermissionStatus(): Promise<PermissionStatus> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'denied')  return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

export async function requestNotificationPermission(): Promise<PermissionStatus> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return 'granted';
    const { status: requested } = await Notifications.requestPermissionsAsync();
    if (requested === 'granted') return 'granted';
    return 'denied';
  } catch {
    return 'denied';
  }
}

// ── Cancel stored IDs for a user ──

export async function cancelUserHifzNotifications(userId: string): Promise<void> {
  try {
    const ids = await getScheduledNotificationIds(userId);
    await Promise.all(
      ids.map(id =>
        Notifications.cancelScheduledNotificationAsync(id).catch(() => {}),
      ),
    );
    await saveScheduledNotificationIds(userId, []);
  } catch {
    // Non-fatal
  }
}

// ── Schedule daily reminder ──
// Schedules exactly one repeating daily notification at the selected time.
// This fires every day indefinitely — no 30-day expiry.
// The single notification ID is stored so it can be cancelled on disable/logout.

export async function scheduleDailyHifzReminder(
  userId: string,
  settings: NotificationSettings,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureAndroidChannel();

    // Cancel any previously scheduled notifications for this user first
    await cancelUserHifzNotifications(userId);

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Ton Hifz t'attend.",
        body:  'Protège ce que tu as appris et avance avec sérénité.',
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: {
        type:    Notifications.SchedulableTriggerInputTypes.DAILY,
        hour:    settings.hour,
        minute:  settings.minute,
      },
    });

    await saveScheduledNotificationIds(userId, [id]);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Erreur inconnue.';
    return { ok: false, error };
  }
}

// ── Test notification ──
// Fires once after 4 seconds. Not stored, not repeating.
// Returns rich diagnostic info for manual QA.

export interface TestNotificationResult {
  ok:                       boolean;
  error?:                   string;
  permissionStatus:         PermissionStatus;
  scheduledId?:             string;
  scheduledCountAfter?:     number;
  platform:                 string;
}

export async function sendTestNotification(): Promise<TestNotificationResult> {
  const platform = Platform.OS;
  const permissionStatus = await getNotificationPermissionStatus();

  if (permissionStatus !== 'granted') {
    return { ok: false, error: 'Permission non accordée.', permissionStatus, platform };
  }

  try {
    await ensureAndroidChannel();
    const scheduledId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Test — Ton Hifz t'attend.",
        body:  'Les notifications Zainly fonctionnent correctement.',
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: {
        type:    Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 4,
        repeats: false,
      },
    });

    const all = await Notifications.getAllScheduledNotificationsAsync();
    const scheduledCountAfter = all.length;

    return { ok: true, permissionStatus, scheduledId, scheduledCountAfter, platform };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Erreur inconnue.';
    if (__DEV__) console.warn('[notifications] test failed', error);
    return { ok: false, error, permissionStatus, platform };
  }
}
