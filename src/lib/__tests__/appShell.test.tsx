// ─── App shell integration test ──────────────────────────────────────────────
// Covers the new root AuthGate, the generic useLogout cleanup, and the
// cross-account data isolation provided by the RevenueCat provider.
// These tests render with react-test-renderer and assert on mocked
// primitives instead of on native host output.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { useSessionResultStore } from '@/store/sessionResultStore';
import { useLogout } from '@/hooks/useLogout';
import { RevenueCatProvider } from '@/components/providers/RevenueCatProvider';
import { AuthGate } from '../../../app/_layout';
import { supabase } from '@/db/client';
import {
  revenueCatLogIn,
  revenueCatLogOut,
  configureRevenueCatOnce,
} from '@/lib/revenueCat';
import { cancelUserHifzNotifications } from '@/notifications/scheduler';
import { clearNotificationData } from '@/notifications/storage';

let mockPathname = '/';

jest.mock('expo-router', () => {
  const Slot = jest.fn(() => null);
  const Redirect = jest.fn(() => null);
  const usePathname = jest.fn(() => mockPathname);
  return {
    __esModule: true,
    Slot,
    Redirect,
    usePathname,
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  AndroidImportance: { DEFAULT: 4 },
  SchedulableTriggerInputTypes: {
    DAILY: 'daily',
    TIME_INTERVAL: 'timeInterval',
  },
}));

jest.mock('@/db/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: null } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      signOut: jest.fn(() => Promise.resolve({ error: null })),
    },
  },
}));

jest.mock('@/lib/revenueCat', () => ({
  configureRevenueCatOnce: jest.fn(() => Promise.resolve()),
  revenueCatLogIn: jest.fn(() => Promise.resolve(true)),
  revenueCatLogOut: jest.fn(() => Promise.resolve()),
  getRevenueCatCurrentUserId: jest.fn(() => null),
  getRevenueCatCustomerInfo: jest.fn(() => Promise.resolve(null)),
  ensureRevenueCatReadyForUser: jest.fn(() => Promise.resolve({ ready: true, generation: 0 })),
}));

jest.mock('@/notifications/scheduler', () => ({
  cancelUserHifzNotifications: jest.fn(() => Promise.resolve()),
  scheduleDailyHifzReminder: jest.fn(() => Promise.resolve({ ok: true })),
  sendTestNotification: jest.fn(() => Promise.resolve({ ok: true, permissionStatus: 'granted' })),
}));

jest.mock('@/notifications/storage', () => ({
  clearNotificationData: jest.fn(() => Promise.resolve()),
  getNotificationSettings: jest.fn(() => Promise.resolve({ enabled: false, hour: 9, minute: 0 })),
  saveNotificationSettings: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiRemove: jest.fn(() => Promise.resolve()),
    getAllKeys: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {},
  LOG_LEVEL: { WARN: 'WARN' },
  PURCHASES_ERROR_CODE: {},
}));

const {
  Slot,
  Redirect,
} = jest.requireMock('expo-router');

describe('App shell', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: null,
      user: null,
      ready: false,
    } as any);
    useSessionResultStore.setState({
      result: null,
    } as any);
    mockPathname = '/';
    jest.clearAllMocks();
  });

  it('hides every business route while auth is not yet hydrated', () => {
    useAuthStore.setState({ ready: false, session: null, user: null } as any);
    mockPathname = '/';
    act(() => {
      renderer.create(<AuthGate />);
    });
    expect(Slot).not.toHaveBeenCalled();
    expect(Redirect).not.toHaveBeenCalled();
  });

  it('renders the public placeholder for a visitor on /', () => {
    useAuthStore.setState({
      ready: true,
      session: null,
      user: null,
    } as any);
    mockPathname = '/';
    act(() => {
      renderer.create(<AuthGate />);
    });
    expect(Slot).toHaveBeenCalled();
    expect(Redirect).not.toHaveBeenCalled();
  });

  it('redirects an authenticated user from / to /(app)', () => {
    useAuthStore.setState({
      ready: true,
      session: { user: { id: 'A' } },
      user: { id: 'A' },
    } as any);
    mockPathname = '/';
    act(() => {
      renderer.create(<AuthGate />);
    });
    expect(Redirect.mock.calls.some((call: any[]) => call[0]?.href === '/(app)')).toBe(true);
    expect(Slot).not.toHaveBeenCalled();
  });

  it('redirects a visitor trying to reach (app) back to /', () => {
    useAuthStore.setState({
      ready: true,
      session: null,
      user: null,
    } as any);
    mockPathname = '/(app)/(tabs)';
    act(() => {
      renderer.create(<AuthGate />);
    });
    expect(Redirect.mock.calls.some((call: any[]) => call[0]?.href === '/')).toBe(true);
    expect(Slot).not.toHaveBeenCalled();
  });

  it('RevenueCatProvider switches identity on A -> B and invalidates entitlement cache', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    useAuthStore.setState({
      ready: true,
      session: { user: { id: 'A' } },
      user: { id: 'A' },
    } as any);

    act(() => {
      renderer.create(
        <QueryClientProvider client={queryClient}>
          <RevenueCatProvider>
            <></>
          </RevenueCatProvider>
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(configureRevenueCatOnce).toHaveBeenCalled();
    expect(revenueCatLogIn).toHaveBeenCalledWith('A');

    await act(async () => {
      useAuthStore.setState({
        session: { user: { id: 'B' } },
        user: { id: 'B' },
      } as any);
      await Promise.resolve();
    });

    expect(revenueCatLogIn).toHaveBeenCalledWith('B');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['revenueCatCustomerInfo'],
    });
  });

  it('RevenueCatProvider logs out when the user becomes null', async () => {
    useAuthStore.setState({
      ready: true,
      session: { user: { id: 'A' } },
      user: { id: 'A' },
    } as any);

    act(() => {
      renderer.create(
        <QueryClientProvider client={new QueryClient()}>
          <RevenueCatProvider>
            <></>
          </RevenueCatProvider>
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      useAuthStore.setState({
        session: null,
        user: null,
      } as any);
      await Promise.resolve();
    });

    expect(revenueCatLogOut).toHaveBeenCalled();
  });

  it('useLogout clears every generic user-scoped resource', async () => {
    const queryClient = new QueryClient();
    const clearSpy = jest.spyOn(queryClient, 'clear');

    useAuthStore.setState({
      ready: true,
      session: { user: { id: 'A' } },
      user: { id: 'A' },
    } as any);

    useSessionResultStore.getState().setResult({
      surahName: 'Al-Fatiha',
      surahNumber: 1,
      fromAyah: 1,
      toAyah: 7,
      newAyatCount: 7,
      reviewsCompleted: 0,
      difficulty: 'normal' as any,
      streak: 0,
      completedAt: new Date().toISOString(),
    });

    let logoutRef: () => Promise<void>;
    function TestComp() {
      const { performLogout } = useLogout();
      logoutRef = performLogout;
      return null;
    }

    let root: any;
    act(() => {
      root = renderer.create(
        <QueryClientProvider client={queryClient}>
          <TestComp />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await logoutRef!();
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(revenueCatLogOut).toHaveBeenCalled();
    expect(cancelUserHifzNotifications).toHaveBeenCalledWith('A');
    expect(clearNotificationData).toHaveBeenCalledWith('A');
    expect(clearSpy).toHaveBeenCalled();
    expect(useSessionResultStore.getState().result).toBeNull();

    root.unmount();
  });
});
