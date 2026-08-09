import { createContext, useContext, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  subscribeToTransitionLease,
  getLeaseSnapshot,
  signalDashboardReady,
  type LeaseSnapshot,
} from '@/lib/transitionLease';
import { planQueryOptions, progressQueryOptions } from '@/queries';
import { useAuthStore } from '@/store/authStore';

interface DashboardReadyContextValue {
  onDashboardLayout: () => void;
  leaseSnapshot: LeaseSnapshot;
}

const DashboardReadyContext = createContext<DashboardReadyContextValue | null>(null);

export function useDashboardReady(): DashboardReadyContextValue {
  const ctx = useContext(DashboardReadyContext);
  if (!ctx) {
    return {
      onDashboardLayout: () => {},
      leaseSnapshot: getLeaseSnapshot(),
    };
  }
  return ctx;
}

export function DashboardReadyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const signaledRef = useRef(false);

  const leaseSnapshot = useSyncExternalStore(
    subscribeToTransitionLease,
    getLeaseSnapshot,
    getLeaseSnapshot,
  );

  const userId = useAuthStore((s) => s.session?.user?.id ?? null);

  useEffect(() => {
    if (leaseSnapshot.phase === 'idle') {
      signaledRef.current = false;
    }
  }, [leaseSnapshot.phase]);

  useEffect(() => {
    signaledRef.current = false;
  }, [userId]);

  const onDashboardLayout = useCallback(() => {
    const snapshot = getLeaseSnapshot();
    if (snapshot.phase !== 'data_ready_covered') return;
    if (signaledRef.current) return;

    const session = useAuthStore.getState().session;
    const currentUserId = session?.user?.id ?? null;
    if (!currentUserId) return;
    if (snapshot.userId !== currentUserId) return;
    if (!snapshot.leaseId || !snapshot.flowId || !snapshot.sessionGen) return;

    const planKey = planQueryOptions(currentUserId).queryKey;
    const progressKey = progressQueryOptions(currentUserId).queryKey;
    const cachedPlan = queryClient.getQueryData(planKey);
    const cachedProgress = queryClient.getQueryData(progressKey);
    if (!cachedPlan || !cachedProgress) return;

    const ok = signalDashboardReady(
      snapshot.leaseId,
      snapshot.flowId,
      currentUserId,
      snapshot.sessionGen,
    );
    if (ok) {
      signaledRef.current = true;
    }
  }, [queryClient]);

  const value = useMemo<DashboardReadyContextValue>(
    () => ({ onDashboardLayout, leaseSnapshot }),
    [onDashboardLayout, leaseSnapshot],
  );

  return (
    <DashboardReadyContext.Provider value={value}>
      {children}
    </DashboardReadyContext.Provider>
  );
}

export { DashboardReadyContext };
