import { useQuery } from '@tanstack/react-query';
import { fetchProfile } from '@/db/profiles';

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });
}
