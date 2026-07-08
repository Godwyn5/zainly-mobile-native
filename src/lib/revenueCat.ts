// ─── RevenueCat client wrapper (Phase 1 — read-only) ──────────────────────────
// This is the ONLY file allowed to import 'react-native-purchases' directly.
// Scope: configure + identify + read CustomerInfo/entitlement.
// No purchase, no restore, no secret keys. iOS only for now.

import { Platform } from 'react-native';
import Purchases, { CustomerInfo } from 'react-native-purchases';

const DEFAULT_ENTITLEMENT_ID = 'zainly_plus';

let isConfigured = false;
let configurePromise: Promise<void> | null = null;

function getIosApiKey(): string | undefined {
  return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
}

function devWarn(message: string) {
  if (__DEV__) {
    console.warn(`[revenueCat] ${message}`);
  }
}

/**
 * Configures the RevenueCat SDK exactly once for the lifetime of the app.
 * Safe to call multiple times — subsequent calls are no-ops.
 * Never throws: if the platform is unsupported or the API key is missing,
 * it logs a dev-only warning and resolves without configuring the SDK.
 */
export async function configureRevenueCatOnce(userId?: string | null): Promise<void> {
  if (isConfigured) return;
  if (configurePromise) return configurePromise;

  configurePromise = (async () => {
    if (Platform.OS !== 'ios') {
      devWarn('Skipped configure — only iOS is supported in Phase 1.');
      return;
    }

    const apiKey = getIosApiKey();
    if (!apiKey) {
      devWarn(
        'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY is missing — RevenueCat will not be configured.'
      );
      return;
    }

    try {
      Purchases.configure({
        apiKey,
        appUserID: userId ?? undefined,
      });
      isConfigured = true;
    } catch (err) {
      devWarn(`configure() failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  return configurePromise;
}

/**
 * Identifies the current Supabase user to RevenueCat via Purchases.logIn.
 * No-op (with dev warning) if RevenueCat is not configured or on unsupported platforms.
 * Never throws.
 */
export async function revenueCatLogIn(userId: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!isConfigured) {
    devWarn('logIn skipped — RevenueCat is not configured.');
    return;
  }

  try {
    await Purchases.logIn(userId);
  } catch (err) {
    devWarn(`logIn failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Logs out the current RevenueCat user (best-effort).
 * Never throws — safe to call even if RevenueCat is not configured
 * or the current user is already anonymous.
 */
export async function revenueCatLogOut(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!isConfigured) return;

  try {
    await Purchases.logOut();
  } catch (err) {
    devWarn(`logOut failed (best-effort, ignored): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Returns the current CustomerInfo, or null if unavailable
 * (unsupported platform, not configured, or a fetch error occurred).
 * Never throws.
 */
export async function getRevenueCatCustomerInfo(): Promise<CustomerInfo | null> {
  if (Platform.OS !== 'ios') return null;
  if (!isConfigured) {
    devWarn('getCustomerInfo skipped — RevenueCat is not configured.');
    return null;
  }

  try {
    return await Purchases.getCustomerInfo();
  } catch (err) {
    devWarn(`getCustomerInfo failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Pure helper: checks whether the given CustomerInfo has the specified
 * entitlement currently active (covers both 'active' and 'trialing' states,
 * since RevenueCat surfaces both under entitlements.active).
 */
export function hasRevenueCatEntitlement(
  customerInfo: CustomerInfo | null | undefined,
  entitlementId: string = DEFAULT_ENTITLEMENT_ID
): boolean {
  if (!customerInfo) return false;
  return customerInfo.entitlements.active[entitlementId] !== undefined;
}

export type { CustomerInfo };
