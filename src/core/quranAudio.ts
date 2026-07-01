// ─── Quran Audio URL helper ───────────────────────────────────────────────────
//
// Source: everyayah.com — verse-by-verse MP3 files.
// URL pattern: https://everyayah.com/data/{reciter_dir}/{SSSAAA}.mp3
//   SSS = zero-padded surah  (3 digits)
//   AAA = zero-padded ayah   (3 digits)
//
// Reciter catalogue lives in src/core/reciters.ts.
// Default reciter: Al-Husary (free, always available).
//
// NOTE: everyayah.com is a well-known public Quran audio repository used by
// many Quran apps. Zainly does not claim any specific licensing endorsement.
// Use neutral copy in the UI ("Récitateur : Al-Husary").

import { RECITERS, DEFAULT_RECITER, type ReciterId } from './reciters';

// QuranAudioReciter is kept as a re-export alias for full backwards compatibility
// with all existing call sites that import this type from quranAudio.
export type QuranAudioReciter = ReciterId;

const BASE_URL = 'https://everyayah.com/data';

/**
 * Returns the direct MP3 URL for a single ayah.
 *
 * @param surahNumber  1–114
 * @param ayahNumber   1–286 (varies by surah)
 * @param reciter      Defaults to DEFAULT_RECITER ('husary')
 */
export function getAyatAudioUrl({
  surahNumber,
  ayahNumber,
  reciter = DEFAULT_RECITER,
}: {
  surahNumber: number;
  ayahNumber:  number;
  reciter?:    ReciterId;
}): string {
  const s   = String(surahNumber).padStart(3, '0');
  const a   = String(ayahNumber).padStart(3, '0');
  const dir = RECITERS[reciter].dir;
  return `${BASE_URL}/${dir}/${s}${a}.mp3`;
}
