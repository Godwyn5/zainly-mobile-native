// ─── Local Quran Data Loader ─────────────────────────────────────────────────
// Reads from bundled assets only. No network fetch. No API. No secrets.
// Multi-riwaya-ready: only 'hafs' is activated (verified 114 surahs / 6236 ayahs).
// Warsh / Qalun: architecture present, datasets not installed.

import type {
  QuranRiwaya,
  QuranAyahContent,
  QuranContentResult,
  QuranSurahContent,
  QuranDatasetValidation,
  RawQuranSurah,
  RawQuranFrSurah,
  RawQuranFrVerse,
} from './types';

// ─── Raw data imports (bundled at build time via Metro) ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rawHafs: RawQuranSurah[]   = require('../../../assets/data/quran.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rawHafsFr: RawQuranFrSurah[] = require('../../../assets/data/quran_fr.json');

// ─── Riwaya availability registry ─────────────────────────────────────────────
// Only list a riwaya here when its full verified dataset is bundled.

const AVAILABLE_RIWAYAT: Set<QuranRiwaya> = new Set(['hafs']);

export function isRiwayaAvailable(riwaya: QuranRiwaya): boolean {
  return AVAILABLE_RIWAYAT.has(riwaya);
}

export function getAvailableRiwayat(): QuranRiwaya[] {
  return Array.from(AVAILABLE_RIWAYAT);
}

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Caches merged QuranSurahContent per riwaya per surah after first load.

const surahCache = new Map<string, QuranSurahContent>();

function surahCacheKey(riwaya: QuranRiwaya, surahNumber: number): string {
  return `${riwaya}:${surahNumber}`;
}

// ─── Hafs merger ──────────────────────────────────────────────────────────────
// Merges Arabic + transliteration (quran.json) with French translation (quran_fr.json).

function loadHafsSurah(surahNumber: number): QuranSurahContent | null {
  const cacheKey = surahCacheKey('hafs', surahNumber);
  const cached = surahCache.get(cacheKey);
  if (cached) return cached;

  const rawSurah = rawHafs.find(s => s.id === surahNumber);
  if (!rawSurah) return null;

  const rawFrSurah = rawHafsFr.find(s => s.id === surahNumber);

  const frVerseMap = new Map<number, string>();
  if (rawFrSurah) {
    rawFrSurah.verses.forEach((v: RawQuranFrVerse) => {
      frVerseMap.set(v.id, v.translation ?? null);
    });
  }

  const ayahs: QuranAyahContent[] = rawSurah.verses.map(v => ({
    surahNumber,
    ayahNumber: v.id,
    arabic: v.text,
    transliteration: v.transliteration ?? null,
    translationFr: frVerseMap.get(v.id) ?? null,
  }));

  const result: QuranSurahContent = {
    riwaya: 'hafs',
    surahNumber,
    surahName: rawSurah.transliteration,
    ayahs,
  };

  surahCache.set(cacheKey, result);
  return result;
}

// ─── Per-riwaya loader dispatch ───────────────────────────────────────────────

function loadSurah(riwaya: QuranRiwaya, surahNumber: number): QuranSurahContent | null {
  if (riwaya === 'hafs') return loadHafsSurah(surahNumber);
  // warsh and qalun: datasets not installed yet
  return null;
}

// ─── Public: get a range of ayahs ─────────────────────────────────────────────

export function getQuranAyahRange(params: {
  riwaya?: QuranRiwaya;
  surahNumber: number;
  fromAyah: number;
  toAyah: number;
}): QuranContentResult {
  const riwaya = params.riwaya ?? 'hafs';
  const { surahNumber, fromAyah, toAyah } = params;

  if (!isRiwayaAvailable(riwaya)) {
    return { ok: false, error: "Cette riwaya n'est pas encore disponible hors ligne." };
  }
  if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) {
    return { ok: false, error: `Numéro de sourate invalide: ${surahNumber}.` };
  }
  if (!Number.isInteger(fromAyah) || fromAyah < 1) {
    return { ok: false, error: `Numéro d'ayat de départ invalide: ${fromAyah}.` };
  }
  if (!Number.isInteger(toAyah) || toAyah < fromAyah) {
    return { ok: false, error: `Plage d'ayats invalide: ${fromAyah}–${toAyah}.` };
  }

  const surah = loadSurah(riwaya, surahNumber);
  if (!surah) {
    return { ok: false, error: "Le texte Quran local n'est pas encore installé." };
  }

  const filtered = surah.ayahs.filter(
    a => a.ayahNumber >= fromAyah && a.ayahNumber <= toAyah,
  );

  if (filtered.length === 0) {
    return { ok: false, error: `Aucun ayat trouvé dans la plage ${fromAyah}–${toAyah} de la sourate ${surahNumber}.` };
  }

  return { ok: true, ayahs: filtered };
}

// ─── Public: dataset validation ───────────────────────────────────────────────

export function validateQuranDataset(riwaya: QuranRiwaya): QuranDatasetValidation {
  if (!isRiwayaAvailable(riwaya)) {
    return {
      ok: false,
      totalAyahs: 0,
      surahCount: 0,
      errors: [`La riwaya '${riwaya}' n'est pas installée.`],
    };
  }

  if (riwaya !== 'hafs') {
    return {
      ok: false,
      totalAyahs: 0,
      surahCount: 0,
      errors: [`Validation non implémentée pour la riwaya '${riwaya}'.`],
    };
  }

  const errors: string[] = [];
  let totalAyahs = 0;

  if (!Array.isArray(rawHafs) || rawHafs.length === 0) {
    return { ok: false, totalAyahs: 0, surahCount: 0, errors: ['quran.json est vide ou invalide.'] };
  }

  if (rawHafs.length !== 114) {
    errors.push(`Nombre de sourates incorrect: ${rawHafs.length} (attendu: 114).`);
  }

  rawHafs.forEach(surah => {
    const surahAyahs = surah.verses?.length ?? 0;
    totalAyahs += surahAyahs;

    if (surahAyahs !== surah.total_verses) {
      errors.push(`Sourate ${surah.id}: ${surahAyahs} ayats présents, ${surah.total_verses} attendus.`);
    }

    for (let a = 1; a <= surah.total_verses; a++) {
      if (!surah.verses.find(v => v.id === a)) {
        errors.push(`Sourate ${surah.id}: ayat ${a} manquant.`);
      }
    }
  });

  if (totalAyahs !== 6236) {
    errors.push(`Total ayats: ${totalAyahs} (attendu: 6236).`);
  }

  return {
    ok: errors.length === 0,
    totalAyahs,
    surahCount: rawHafs.length,
    errors,
  };
}

// ─── Re-export types for consumers ────────────────────────────────────────────

export type { QuranRiwaya, QuranAyahContent, QuranSurahContent, QuranContentResult, QuranDatasetValidation } from './types';
