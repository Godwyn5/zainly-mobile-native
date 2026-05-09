import {
  ZAINLY_INDEX_BY_SURAH,
  ZAINLY_ORDER,
  nextZainlySurah,
  nextSurahInOrder,
} from './zainlyOrder';

export type PlanSnapshot = {
  ayah_per_day: number;
  plan_mode: 'recommended' | 'start_surah' | 'custom_order';
  custom_surah_order: number[] | null;
};

export type ProgressSnapshot = {
  current_surah: number;
  current_ayah: number;
  ayah_per_day: number;
  streak: number;
  total_memorized: number;
  last_session_date: string | null;
};

export interface TodayProgramme {
  currentSurah: number | null;
  currentAyah: number;
  surahName: string | null;
  surahTotalAyats: number;
  memStart: number | null;
  memEnd: number | null;
  todayAyatCount: number;
  surahExhausted: boolean;
  sessionDoneToday: boolean;
  dueReviewCount: number;
  ayahPerDay: number;
  streak: number;
  totalMemorized: number;
  nextSurah: number | null;
  nextSurahName: string | null;
  sessionFinishesSurah: boolean;
  remainingAfterSession: number;
}

interface Params {
  plan: PlanSnapshot | null | undefined;
  progress: ProgressSnapshot | null | undefined;
  dueReviewCount: number;
  today: string;
}

const SAFE_DEFAULTS: TodayProgramme = {
  currentSurah: null,
  currentAyah: 0,
  surahName: null,
  surahTotalAyats: 0,
  memStart: null,
  memEnd: null,
  todayAyatCount: 0,
  surahExhausted: false,
  sessionDoneToday: false,
  dueReviewCount: 0,
  ayahPerDay: 2,
  streak: 0,
  totalMemorized: 0,
  nextSurah: null,
  nextSurahName: null,
  sessionFinishesSurah: false,
  remainingAfterSession: 0,
};

export function getTodayProgramme({ plan, progress, dueReviewCount, today }: Params): TodayProgramme {
  if (!plan || !progress) return { ...SAFE_DEFAULTS, dueReviewCount };

  const currentSurah = progress.current_surah ?? null;
  const currentAyah = progress.current_ayah ?? 0;
  const ayahPerDay = plan.ayah_per_day ?? progress.ayah_per_day ?? 2;
  const streak = progress.streak ?? 0;
  const totalMemorized = progress.total_memorized ?? 0;
  const sessionDoneToday = progress.last_session_date === today;

  const surahEntry = currentSurah != null ? ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[currentSurah]] : null;
  const surahName = surahEntry?.name ?? null;
  const surahTotalAyats = surahEntry?.ayahs ?? 0;

  const memStart = surahTotalAyats > 0 ? currentAyah + 1 : null;
  const memEnd = (memStart != null && surahTotalAyats > 0)
    ? Math.min(currentAyah + ayahPerDay, surahTotalAyats)
    : null;
  const todayAyatCount = (memStart != null && memEnd != null)
    ? Math.max(memEnd - memStart + 1, 0)
    : 0;
  const surahExhausted = memStart != null ? memStart > surahTotalAyats : false;

  const useCustomOrder =
    (plan.plan_mode === 'custom_order' || plan.plan_mode === 'start_surah') &&
    Array.isArray(plan.custom_surah_order) &&
    plan.custom_surah_order.length > 0;

  const nextSurah = currentSurah != null
    ? useCustomOrder
      ? nextSurahInOrder(currentSurah, plan.custom_surah_order!)
      : nextZainlySurah(currentSurah)
    : null;

  const nextSurahEntry = nextSurah != null ? ZAINLY_ORDER[ZAINLY_INDEX_BY_SURAH[nextSurah]] : null;
  const nextSurahName = nextSurahEntry?.name ?? null;

  const sessionFinishesSurah = !surahExhausted && memEnd != null && memEnd >= surahTotalAyats;
  const remainingAfterSession = (memEnd != null && surahTotalAyats > 0)
    ? Math.max(surahTotalAyats - memEnd, 0)
    : 0;

  return {
    currentSurah,
    currentAyah,
    surahName,
    surahTotalAyats,
    memStart,
    memEnd,
    todayAyatCount,
    surahExhausted,
    sessionDoneToday,
    dueReviewCount,
    ayahPerDay,
    streak,
    totalMemorized,
    nextSurah,
    nextSurahName,
    sessionFinishesSurah,
    remainingAfterSession,
  };
}
