// ─── Notification storage ─────────────────────────────────────────────────────
// All keys are user-scoped so different accounts don't share state.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotificationSettings, DEFAULT_SETTINGS } from './types';

function settingsKey(userId: string): string {
  return `zainly:notifications:settings:${userId}`;
}

function scheduledIdsKey(userId: string): string {
  return `zainly:notifications:scheduledIds:${userId}`;
}

export async function getNotificationSettings(
  userId: string,
): Promise<NotificationSettings> {
  try {
    const raw = await AsyncStorage.getItem(settingsKey(userId));
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveNotificationSettings(
  userId: string,
  settings: NotificationSettings,
): Promise<void> {
  try {
    await AsyncStorage.setItem(settingsKey(userId), JSON.stringify(settings));
  } catch {
    // Non-fatal — settings will revert to defaults on next load
  }
}

export async function getScheduledNotificationIds(
  userId: string,
): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(scheduledIdsKey(userId));
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function saveScheduledNotificationIds(
  userId: string,
  ids: string[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(scheduledIdsKey(userId), JSON.stringify(ids));
  } catch {
    // Non-fatal
  }
}

export async function clearNotificationData(userId: string): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      settingsKey(userId),
      scheduledIdsKey(userId),
    ]);
  } catch {
    // Non-fatal
  }
}
