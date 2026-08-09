/// <reference types="jest" />

// Mock react-native — only Platform and Linking, avoid jest.requireActual
// which triggers native TurboModule initialization.
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: {
    openURL: jest.fn(),
    canOpenURL: jest.fn(),
  },
}));

// Mock the RevenueCat wrapper
jest.mock('@/lib/revenueCat', () => ({
  getRevenueCatCustomerInfo: jest.fn(),
  ensureRevenueCatReadyForUser: jest.fn(),
  getRevenueCatGeneration: jest.fn(),
  getRevenueCatCurrentUserId: jest.fn(),
}));

import { Linking, Platform } from 'react-native';
import { manageSubscription } from '../manageSubscription';
import {
  getRevenueCatCustomerInfo,
  ensureRevenueCatReadyForUser,
  getRevenueCatGeneration,
  getRevenueCatCurrentUserId,
} from '@/lib/revenueCat';

const mockLinkingOpen = Linking.openURL as jest.MockedFunction<typeof Linking.openURL>;
const mockLinkingCanOpen = Linking.canOpenURL as jest.MockedFunction<typeof Linking.canOpenURL>;
const mockGetCustomerInfo = getRevenueCatCustomerInfo as jest.MockedFunction<typeof getRevenueCatCustomerInfo>;
const mockEnsureReady = ensureRevenueCatReadyForUser as jest.MockedFunction<typeof ensureRevenueCatReadyForUser>;
const mockGetGeneration = getRevenueCatGeneration as jest.MockedFunction<typeof getRevenueCatGeneration>;
const mockGetCurrentUserId = getRevenueCatCurrentUserId as jest.MockedFunction<typeof getRevenueCatCurrentUserId>;

describe('manageSubscription (iOS)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'ios';
    mockEnsureReady.mockResolvedValue({ ready: true, generation: 1 });
    mockGetGeneration.mockReturnValue(1);
    mockGetCurrentUserId.mockReturnValue('user-123');
  });

  it('opens RevenueCat managementURL when available', async () => {
    mockGetCustomerInfo.mockResolvedValue({
      managementURL: 'https://app.revenuecat.com/manage/123',
      entitlements: { active: {} },
    } as any);
    mockLinkingCanOpen.mockResolvedValue(true);
    mockLinkingOpen.mockResolvedValue(undefined);

    const result = await manageSubscription('user-123');

    expect(result.ok).toBe(true);
    expect(mockLinkingOpen).toHaveBeenCalledWith('https://app.revenuecat.com/manage/123');
  });

  it('falls back to iOS system subscriptions URL when managementURL is null', async () => {
    mockGetCustomerInfo.mockResolvedValue({
      managementURL: null,
      entitlements: { active: {} },
    } as any);
    mockLinkingOpen.mockResolvedValue(undefined);

    const result = await manageSubscription('user-123');

    expect(result.ok).toBe(true);
    expect(mockLinkingOpen).toHaveBeenCalledWith('itms-apps://apps.apple.com/account/subscriptions');
  });

  it('returns ok:false open_failed when Linking.openURL fails', async () => {
    mockGetCustomerInfo.mockResolvedValue({
      managementURL: null,
      entitlements: { active: {} },
    } as any);
    mockLinkingOpen.mockRejectedValue(new Error('cannot open'));

    const result = await manageSubscription('user-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('open_failed');
    }
  });

  it('returns ok:false not_configured when userId is null', async () => {
    const result = await manageSubscription(undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_configured');
    }
  });

  it('returns ok:false open_failed when canOpenURL returns false', async () => {
    mockGetCustomerInfo.mockResolvedValue({
      managementURL: 'https://app.revenuecat.com/manage/123',
      entitlements: { active: {} },
    } as any);
    mockLinkingCanOpen.mockResolvedValue(false);

    const result = await manageSubscription('user-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('open_failed');
    }
  });

  it('detects identity change and returns not_configured', async () => {
    mockEnsureReady.mockResolvedValue({ ready: true, generation: 1 });
    mockGetGeneration.mockReturnValue(2);
    mockGetCurrentUserId.mockReturnValue('different-user');
    mockGetCustomerInfo.mockResolvedValue({
      managementURL: 'https://app.revenuecat.com/manage/123',
      entitlements: { active: {} },
    } as any);

    const result = await manageSubscription('user-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_configured');
    }
  });
});

describe('manageSubscription (Android)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as any).OS = 'android';
  });

  it('opens Google Play subscriptions URL on Android', async () => {
    mockLinkingOpen.mockResolvedValue(undefined);

    const result = await manageSubscription('user-123');

    expect(result.ok).toBe(true);
    expect(mockLinkingOpen).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
  });

  it('returns ok:false open_failed when Google Play URL fails to open', async () => {
    mockLinkingOpen.mockRejectedValue(new Error('cannot open'));

    const result = await manageSubscription('user-123');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('open_failed');
    }
  });
});
