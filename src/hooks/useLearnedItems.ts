import { useQuery } from '@tanstack/react-query';
import { fetchLearnedItems } from '@/db/reviewItems';

export function useLearnedItems(userId: string | undefined) {
  return useQuery({
    queryKey: ['learnedItems', userId],
    queryFn: () => fetchLearnedItems(userId!),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });
}
