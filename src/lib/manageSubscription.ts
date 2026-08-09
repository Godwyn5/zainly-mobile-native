// ─── manageSubscription ──────────────────────────────────────────────────────
// Opens the platform's subscription management interface for the current
// RevenueCat customer. Uses CustomerInfo.managementURL when available (the
// official RevenueCat-provided URL), falling back to platform-specific
// system URLs.
//
// This is the ONLY place outside src/lib/revenueCat.ts that imports
// react-native-purchases, and only for showManageSubscriptions + CustomerInfo
// type. The identity-safe getRevenueCatCustomerInfo is used to fetch the
// customer info — never a raw Purchases call.

import { Platform, Linking } from 'react-native';
import {
  getRevenueCatCustomerInfo,
  ensureRevenueCatReadyForUser,
  getRevenueCatGeneration,
  getRevenueCatCurrentUserId,
} from '@/lib/revenueCat';

export type ManageSubscriptionResult =
  | { ok: true }
  | { ok: false; reason: 'no_url' | 'open_failed' | 'unsupported_platform' | 'not_configured' };

export async function manageSubscription(userId: string | undefined): Promise<ManageSubscriptionResult> {
  if (Platform.OS === 'android') {
    return openAndroidSubscriptionManagement();
  }

  return openIOSSubscriptionManagement(userId);
}

async function openAndroidSubscriptionManagement(): Promise<ManageSubscriptionResult> {
  try {
    await Linking.openURL('https://play.google.com/store/account/subscriptions');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'open_failed' };
  }
}

async function openIOSSubscriptionManagement(
  userId: string | undefined
): Promise<ManageSubscriptionResult> {
  if (!userId) {
    return { ok: false, reason: 'not_configured' };
  }

  const { ready, generation } = await ensureRevenueCatReadyForUser(userId);
  if (!ready) {
    return { ok: false, reason: 'not_configured' };
  }

  const customerInfo = await getRevenueCatCustomerInfo();

  if (
    getRevenueCatGeneration() !== generation ||
    getRevenueCatCurrentUserId() !== userId
  ) {
    return { ok: false, reason: 'not_configured' };
  }

  const managementURL = (customerInfo as any)?.managementURL as string | null | undefined;

  if (typeof managementURL === 'string' && managementURL.length > 0) {
    try {
      const canOpen = await Linking.canOpenURL(managementURL);
      if (!canOpen) {
        return { ok: false, reason: 'open_failed' };
      }
      await Linking.openURL(managementURL);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'open_failed' };
    }
  }

  // Fallback: iOS system settings subscriptions URL (iOS 15+)
  try {
    await Linking.openURL('itms-apps://apps.apple.com/account/subscriptions');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'open_failed' };
  }
}
