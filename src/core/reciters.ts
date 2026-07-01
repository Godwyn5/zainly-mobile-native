// ─── Reciters catalogue ───────────────────────────────────────────────────────
//
// Single source of truth for all supported Quran audio reciters.
// Audio source: everyayah.com — URL pattern:
//   https://everyayah.com/data/{dir}/{SSS}{AAA}.mp3
//
// isPremium = true  → voice available to Zainly+ subscribers only.
// isPremium = false → available to all users (Al-Husary is the free default).
//
// NOTE: dir values are the exact folder names on everyayah.com.
// Verify availability for edge-case surahs before enabling a reciter in the UI.

export type ReciterId =
  | 'husary'    // Mahmoud Khalil Al-Husary  — default, free
  | 'alafasy'   // Mishary Rashid Alafasy    — Zainly+
  | 'muaiqly'   // Maher Al-Muaiqly          — Zainly+
  | 'minshawi'  // Mohamed Siddiq El-Minshawi — Zainly+
  | 'sudais';   // Abdurrahman As-Sudais      — Zainly+

export type ReciterProfile = {
  id:          ReciterId;
  displayName: string;   // shown in the UI
  dir:         string;   // everyayah.com folder segment
  bitrate:     number;   // kbps — informational
  isPremium:   boolean;  // true = locked behind Zainly+
};

export const RECITERS: Record<ReciterId, ReciterProfile> = {
  husary:   { id: 'husary',   displayName: 'Al-Husary',   dir: 'Husary_128kbps',        bitrate: 128, isPremium: false },
  alafasy:  { id: 'alafasy',  displayName: 'Alafasy',     dir: 'Alafasy_128kbps',        bitrate: 128, isPremium: true  },
  muaiqly:  { id: 'muaiqly',  displayName: 'Al-Muaiqly',  dir: 'MaherAlMuaiqly128kbps', bitrate: 128, isPremium: true  },
  minshawi: { id: 'minshawi', displayName: 'Minshawi',    dir: 'Minshawi_128kbps',       bitrate: 128, isPremium: true  },
  sudais:   { id: 'sudais',   displayName: 'As-Sudais',   dir: 'Sudais_128kbps',         bitrate: 128, isPremium: true  },
};

export const DEFAULT_RECITER: ReciterId = 'husary';
