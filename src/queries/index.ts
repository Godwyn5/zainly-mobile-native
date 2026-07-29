import { UseQueryOptions } from '@tanstack/react-query';
import { fetchPlan } from '@/db/plans';
import { fetchProgress } from '@/db/progress';
import { fetchDueCount } from '@/db/reviewItems';
import { fetchProfile } from '@/db/profiles';

// ─── Date helpers (must match useDueReviews exactly) ────────────────────────

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localMidnightISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ─── Query options for dashboard warm-up ─────────────────────────────────────
// These functions return the exact same queryKey/queryFn as the hooks
// to ensure prefetch populates the same cache that useQuery will consume.

export function planQueryOptions(userId: string | undefined): UseQueryOptions {
  return {
    queryKey: ['plan', userId],
    queryFn: () => fetchPlan(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  };
}

export function progressQueryOptions(userId: string | undefined): UseQueryOptions {
  return {
    queryKey: ['progress', userId],
    queryFn: () => fetchProgress(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  };
}

export function dueReviewsQueryOptions(userId: string | undefined): UseQueryOptions {
  const today = localDateStr();
  const startTodayISO = localMidnightISO();

  return {
    queryKey: ['dueReviews', userId, today],
    queryFn: () => fetchDueCount(userId!, today, startTodayISO),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  };
}

export function profileQueryOptions(userId: string | undefined): UseQueryOptions {
  return {
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  };
}
