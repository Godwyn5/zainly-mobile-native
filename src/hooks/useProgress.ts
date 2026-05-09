import { useQuery } from '@tanstack/react-query';
import { fetchProgress } from '@/db/progress';

export function useProgress(userId: string | undefined) {
  return useQuery({
    queryKey: ['progress', userId],
    queryFn: () => fetchProgress(userId!),
    enabled: !!userId,
    staleTime: 30_000,
  });
}
