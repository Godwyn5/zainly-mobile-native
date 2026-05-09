// TODO: implement session dates helpers
// Pure functions — no React, no Supabase

export function appendSessionDate(existing: string[], today: string): string[] {
  if (existing.includes(today)) return existing;
  return [...existing, today];
}

export function countSessions(sessionDates: string[]): number {
  return sessionDates.length;
}

export function isSessionDoneToday(
  lastSessionDate: string | null,
  today: string,
): boolean {
  return lastSessionDate === today;
}
