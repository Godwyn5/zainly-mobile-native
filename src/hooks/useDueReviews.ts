import { useQuery } from '@tanstack/react-query';
import { fetchDueCount } from '@/db/reviewItems';

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localMidnightISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useDueReviews(userId: string | undefined) {
  const today = localDateStr();
  const startTodayISO = localMidnightISO();

  return useQuery({
    queryKey: ['dueReviews', userId, today],
    queryFn: () => fetchDueCount(userId!, today, startTodayISO),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}
