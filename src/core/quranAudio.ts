// ─── Quran Audio URL helper ───────────────────────────────────────────────────
//
// Source: everyayah.com — verse-by-verse MP3 files.
// URL pattern: https://everyayah.com/data/{reciter_dir}/{SSSAAA}.mp3
//   SSS = zero-padded surah  (3 digits)
//   AAA = zero-padded ayah   (3 digits)
//
// Al-Husary reciter directory on everyayah.com: "Husary_128kbps"
//   Full name: Mahmoud Khalil Al-Husary (murattal)
//   Bitrate: 128 kbps
//   Chosen for Zainly learning sessions: slow, clear, word-by-word regularity.
//
// NOTE: everyayah.com is a well-known public Quran audio repository used by
// many Quran apps. Zainly does not claim any specific licensing endorsement.
// Use neutral copy in the UI ("Récitateur : Al-Husary").

export type QuranAudioReciter = 'husary';

const RECITER_DIRS: Record<QuranAudioReciter, string> = {
  husary: 'Husary_128kbps',
};

const BASE_URL = 'https://everyayah.com/data';

/**
 * Returns the direct MP3 URL for a single ayah.
 *
 * @param surahNumber  1–114
 * @param ayahNumber   1–286 (varies by surah)
 * @param reciter      Defaults to 'husary'
 */
export function getAyatAudioUrl({
  surahNumber,
  ayahNumber,
  reciter = 'husary',
}: {
  surahNumber: number;
  ayahNumber:  number;
  reciter?:    QuranAudioReciter;
}): string {
  const s = String(surahNumber).padStart(3, '0');
  const a = String(ayahNumber).padStart(3, '0');
  return `${BASE_URL}/${RECITER_DIRS[reciter]}/${s}${a}.mp3`;
}
