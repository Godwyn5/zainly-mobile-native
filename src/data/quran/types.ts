// ─── Quran content types — single source of truth for the Zainly session system
// Multi-riwaya-ready. Only activate a riwaya when its verified dataset is present.

export type QuranRiwaya = 'hafs' | 'warsh' | 'qalun';

// Per-ayah content returned to the session UI.
export type QuranAyahContent = {
  surahNumber: number;
  ayahNumber: number;
  arabic: string;
  transliteration?: string | null;
  translationFr?: string | null;
};

// A full surah's worth of content (used internally by the loader).
export type QuranSurahContent = {
  riwaya: QuranRiwaya;
  surahNumber: number;
  surahName?: string;
  ayahs: QuranAyahContent[];
};

// Discriminated union — all callers must check ok before using ayahs.
export type QuranContentResult =
  | { ok: true;  ayahs: QuranAyahContent[] }
  | { ok: false; error: string };

// Shape of one surah entry in the local quran.json asset.
export type RawQuranVerse = {
  id: number;
  text: string;
  transliteration?: string;
};

export type RawQuranSurah = {
  id: number;
  name: string;
  transliteration: string;
  type: string;
  total_verses: number;
  verses: RawQuranVerse[];
};

// Shape of one surah entry in the local quran_fr.json asset.
export type RawQuranFrVerse = {
  id: number;
  text: string;
  translation: string;
};

export type RawQuranFrSurah = {
  id: number;
  name: string;
  transliteration: string;
  translation: string;
  type: string;
  total_verses: number;
  verses: RawQuranFrVerse[];
};

// Validation result for a dataset integrity check.
export type QuranDatasetValidation = {
  ok: boolean;
  totalAyahs: number;
  surahCount: number;
  errors: string[];
};
