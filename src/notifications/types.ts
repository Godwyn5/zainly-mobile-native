// ─── Notification types ───────────────────────────────────────────────────────

export type NotificationPreset = 'morning' | 'afternoon' | 'evening';

export interface NotificationSettings {
  enabled:  boolean;
  hour:     number;
  minute:   number;
  preset:   NotificationPreset;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  hour:    20,
  minute:  30,
  preset:  'evening',
};

export const PRESETS: Record<NotificationPreset, { label: string; hour: number; minute: number }> = {
  morning:   { label: 'Matin',       hour: 8,  minute: 0  },
  afternoon: { label: 'Après-midi',  hour: 17, minute: 30 },
  evening:   { label: 'Soir',        hour: 20, minute: 30 },
};

