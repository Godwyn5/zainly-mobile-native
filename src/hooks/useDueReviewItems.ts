import { useQuery } from '@tanstack/react-query';
import { fetchDueReviewItems, REVIEW_BATCH_CAP } from '@/db/reviewItems';

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localMidnightISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useDueReviewItems(userId: string | undefined) {
  const today        = localDateStr();
  const startTodayISO = localMidnightISO();

  return useQuery({
    queryKey: ['dueReviewItems', userId, today],
    queryFn:  () => fetchDueReviewItems(userId!, today, startTodayISO, REVIEW_BATCH_CAP),
    enabled:  !!userId,
    staleTime: 0,  // always fresh — session mutates these rows
  });
}
