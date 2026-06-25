import { useQuery } from '@tanstack/react-query';
import { fetchPlan } from '@/db/plans';

export function usePlan(userId: string | undefined) {
  return useQuery({
    queryKey: ['plan', userId],
    queryFn: () => fetchPlan(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}
