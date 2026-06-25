// ─── useNotificationSettings ──────────────────────────────────────────────────
// Manages notification settings for the current user:
//   • loads settings from AsyncStorage on mount
//   • checks live permission status on focus
//   • exposes enable/disable/changePreset/sendTest actions

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Linking, Platform } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import {
  getNotificationSettings,
  saveNotificationSettings,
} from '@/notifications/storage';
import {
  cancelUserHifzNotifications,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  scheduleDailyHifzReminder,
  sendTestNotification,
  PermissionStatus,
} from '@/notifications/scheduler';
import {
  DEFAULT_SETTINGS,
  NotificationPreset,
  NotificationSettings,
  PRESETS,
} from '@/notifications/types';

export type NotificationUIState =
  | 'loading'      // initial hydration
  | 'disabled'     // user has not enabled yet
  | 'enabled'      // active and scheduled
  | 'denied'       // system permission denied
  | 'error';       // scheduling error

interface UseNotificationSettingsReturn {
  uiState:    NotificationUIState;
  settings:   NotificationSettings;
  permStatus: PermissionStatus;
  isBusy:     boolean;
  testSent:   boolean;
  testMsg:    string | null;
  errorMsg:   string | null;
  enable:     () => Promise<void>;
  disable:    () => Promise<void>;
  changePreset: (preset: NotificationPreset) => Promise<void>;
  sendTest:   () => Promise<void>;
  openSystemSettings: () => void;
  refresh:    () => Promise<void>;
}

export function useNotificationSettings(): UseNotificationSettingsReturn {
  const userId = useAuthStore(s => s.user?.id);

  const [settings,   setSettings]   = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [permStatus, setPermStatus] = useState<PermissionStatus>('undetermined');
  const [uiState,    setUiState]    = useState<NotificationUIState>('loading');
  const [isBusy,     setIsBusy]     = useState(false);
  const [testSent,   setTestSent]   = useState(false);
  const [testMsg,    setTestMsg]    = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── derive uiState from settings + permStatus ──
  const deriveUIState = useCallback(
    (s: NotificationSettings, p: PermissionStatus): NotificationUIState => {
      if (p === 'denied')  return 'denied';
      if (s.enabled)       return 'enabled';
      return 'disabled';
    },
    [],
  );

  // ── load + check on mount / userId change ──
  const refresh = useCallback(async () => {
    if (!userId) {
      if (mountedRef.current) setUiState('disabled');
      return;
    }
    try {
      const [s, p] = await Promise.all([
        getNotificationSettings(userId),
        getNotificationPermissionStatus(),
      ]);
      if (!mountedRef.current) return;
      setSettings(s);
      setPermStatus(p);
      setUiState(deriveUIState(s, p));
    } catch {
      if (mountedRef.current) setUiState('disabled');
    }
  }, [userId, deriveUIState]);

  useEffect(() => { refresh(); }, [refresh]);

  // Re-check permission when app returns to foreground (user may have changed it in Settings)
  useEffect(() => {
    const handler = (next: AppStateStatus) => {
      if (next === 'active') refresh();
    };
    const sub = AppState.addEventListener('change', handler);
    return () => sub.remove();
  }, [refresh]);

  // ── enable ──
  const enable = useCallback(async () => {
    if (!userId || isBusy) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const perm = await requestNotificationPermission();
      if (!mountedRef.current) return;
      setPermStatus(perm);
      if (perm !== 'granted') {
        setUiState('denied');
        return;
      }
      const newSettings: NotificationSettings = {
        ...settings,
        enabled: true,
        preset:  settings.preset ?? 'evening',
        hour:    PRESETS[settings.preset ?? 'evening'].hour,
        minute:  PRESETS[settings.preset ?? 'evening'].minute,
      };
      const result = await scheduleDailyHifzReminder(userId, newSettings);
      if (!mountedRef.current) return;
      if (!result.ok) {
        setErrorMsg(result.error ?? 'Erreur lors de la planification.');
        setUiState('error');
        return;
      }
      await saveNotificationSettings(userId, newSettings);
      if (!mountedRef.current) return;
      setSettings(newSettings);
      setUiState('enabled');
    } catch (err) {
      if (mountedRef.current) {
        setErrorMsg(err instanceof Error ? err.message : 'Erreur inconnue.');
        setUiState('error');
      }
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  }, [userId, isBusy, settings]);

  // ── disable ──
  const disable = useCallback(async () => {
    if (!userId || isBusy) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      await cancelUserHifzNotifications(userId);
      const newSettings: NotificationSettings = { ...settings, enabled: false };
      await saveNotificationSettings(userId, newSettings);
      if (!mountedRef.current) return;
      setSettings(newSettings);
      setUiState('disabled');
    } catch {
      // Non-fatal — show disabled state anyway
      if (mountedRef.current) setUiState('disabled');
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  }, [userId, isBusy, settings]);

  // ── changePreset ──
  const changePreset = useCallback(async (preset: NotificationPreset) => {
    if (!userId || isBusy) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const { hour, minute } = PRESETS[preset];
      const newSettings: NotificationSettings = { ...settings, preset, hour, minute };
      if (newSettings.enabled) {
        const result = await scheduleDailyHifzReminder(userId, newSettings);
        if (!mountedRef.current) return;
        if (!result.ok) {
          setErrorMsg(result.error ?? 'Erreur lors de la planification.');
          return;
        }
      }
      await saveNotificationSettings(userId, newSettings);
      if (!mountedRef.current) return;
      setSettings(newSettings);
    } catch {
      // Non-fatal
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  }, [userId, isBusy, settings]);

  // ── sendTest ──
  const sendTest = useCallback(async () => {
    if (isBusy) return;
    setIsBusy(true);
    setTestSent(false);
    setTestMsg(null);
    try {
      const result = await sendTestNotification();
      if (!mountedRef.current) return;
      if (result.ok && result.scheduledId) {
        setTestSent(true);
        setTestMsg('Test programmé. Tu le recevras dans ∼4 s.');
        setTimeout(() => {
          if (mountedRef.current) { setTestSent(false); setTestMsg(null); }
        }, 8000);
      } else {
        const msg = result.error ?? 'Le test n’a pas pu être programmé. Vérifie les permissions.';
        setErrorMsg(msg);
        setTestMsg(null);
      }
    } catch {
      // Non-fatal
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  }, [isBusy]);

  // ── openSystemSettings ──
  const openSystemSettings = useCallback(() => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:').catch(() => {});
    } else {
      Linking.openSettings().catch(() => {});
    }
  }, []);

  return {
    uiState,
    settings,
    permStatus,
    isBusy,
    testSent,
    testMsg,
    errorMsg,
    enable,
    disable,
    changePreset,
    sendTest,
    openSystemSettings,
    refresh,
  };
}
