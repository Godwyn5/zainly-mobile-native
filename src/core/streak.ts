// TODO: implement streak calculation
// Pure function — no React, no Supabase

export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeNewStreak(
  lastSessionDate: string | null,
  currentStreak: number,
  today: string = localDateStr(),
): number {
  if (!lastSessionDate) return 1;
  if (lastSessionDate === today) return currentStreak;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = localDateStr(yesterday);

  const base = lastSessionDate === yesterdayStr ? currentStreak : 0;
  return base + 1;
}
