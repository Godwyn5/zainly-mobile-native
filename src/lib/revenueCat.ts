// ─── RevenueCat client wrapper (Phase 1 read + Phase 2 purchase) ──────────────
// This is the ONLY file allowed to import 'react-native-purchases' directly.
// Scope: configure + identify + read CustomerInfo/entitlement + fetch offerings
// on demand (only when the paywall screen asks for them, never at app launch)
// + purchase/restore. No secret keys. iOS only for now.

import { Platform } from 'react-native';
import Purchases, {
  CustomerInfo,
  LOG_LEVEL,
  PurchasesOffering,
  PurchasesPackage,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';

const DEFAULT_ENTITLEMENT_ID = 'zainly_plus';

let isConfigured = false;
let configurePromise: Promise<void> | null = null;
let isLoggedIn = false;

function getIosApiKey(): string | undefined {
  return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
}

function devWarn(message: string) {
  if (__DEV__) {
    console.warn(`[revenueCat] ${message}`);
  }
}

/**
 * Temporary debug function to log RevenueCat state in development.
 * Logs Supabase user ID, RevenueCat appUserID, CustomerInfo, entitlement status,
 * offerings, packages, product identifiers, and any errors.
 */
export async function debugRevenueCatState(supabaseUserId: string | undefined): Promise<void> {
  if (!__DEV__) return;

  console.log('╔═════════════════════════════════════════════════════════════════════╗');
  console.log('║ [RC DEBUG] RevenueCat State                                        ║');
  console.log('╚═════════════════════════════════════════════════════════════════════╝');
  console.log(`[RC DEBUG] Supabase user id: ${supabaseUserId ?? 'null'}`);

  if (Platform.OS !== 'ios') {
    console.log('[RC DEBUG] Platform: not iOS - RevenueCat not supported in Phase 1');
    return;
  }

  if (!isConfigured) {
    console.log('[RC DEBUG] RevenueCat is not configured');
    return;
  }

  try {
    // Purchases.getAppUserID() returns the CURRENT identified appUserID.
    // customerInfo.originalAppUserId is NOT the same thing: it's the
    // historical/original ID recorded for this customer record and stays
    // as the pre-alias anonymous ID even after a successful logIn().
    const currentAppUserId = await Purchases.getAppUserID();
    const customerInfo = await Purchases.getCustomerInfo();
    console.log(`[RC DEBUG] RevenueCat appUserID (current, Purchases.getAppUserID): ${currentAppUserId ?? 'null'}`);
    console.log(`[RC DEBUG] RevenueCat originalAppUserId (historical, informational only): ${customerInfo.originalAppUserId ?? 'null'}`);
    console.log(
      `[RC DEBUG] Supabase user id === RevenueCat current appUserID: ${
        !!supabaseUserId && currentAppUserId === supabaseUserId
      }`
    );
    console.log(
      `[RC DEBUG] Entitlement zainly_plus active: ${hasRevenueCatEntitlement(customerInfo, 'zainly_plus')}`
    );

    if (customerInfo.entitlements.active.zainly_plus) {
      const entitlement = customerInfo.entitlements.active.zainly_plus;
      console.log(`[RC DEBUG] zainly_plus entitlement details:`, {
        isActive: entitlement.isActive,
        willRenew: entitlement.willRenew,
        periodType: entitlement.periodType,
        latestPurchaseDate: entitlement.latestPurchaseDate,
        expirationDate: entitlement.expirationDate,
        productIdentifier: entitlement.productIdentifier,
      });
    }

    // Log active subscriptions
    const activeSubscriptions = customerInfo.activeSubscriptions;
    console.log(
      `[RC DEBUG] Active subscriptions: ${Object.keys(activeSubscriptions).length > 0 ? Object.keys(activeSubscriptions).join(', ') : 'none'}`
    );

    // Try to fetch offerings for debug
    try {
      const offerings = await Purchases.getOfferings();
      console.log(`[RC DEBUG] Current offering: ${offerings.current?.identifier ?? 'null'}`);
      console.log(
        `[RC DEBUG] Available offerings: ${Object.keys(offerings.all).join(', ') || 'none'}`
      );

      const defaultOffering = offerings.all['default'];
      if (defaultOffering) {
        const { annual, monthly } = getZainlyPlusPackages(defaultOffering);
        console.log(`[RC DEBUG] Annual package: ${annual ? annual.identifier : 'null'}`);
        console.log(`[RC DEBUG] Monthly package: ${monthly ? monthly.identifier : 'null'}`);

        if (annual) {
          console.log(`[RC DEBUG] Annual product identifier: ${annual.product.identifier}`);
          console.log(`[RC DEBUG] Annual price: ${annual.product.priceString}`);
          console.log(`[RC DEBUG] Annual intro price: ${annual.product.introPrice?.priceString ?? 'none'}`);
        }
        if (monthly) {
          console.log(`[RC DEBUG] Monthly product identifier: ${monthly.product.identifier}`);
          console.log(`[RC DEBUG] Monthly price: ${monthly.product.priceString}`);
          console.log(`[RC DEBUG] Monthly intro price: ${monthly.product.introPrice?.priceString ?? 'none'}`);
        }
      } else {
        console.log('[RC DEBUG] No "default" offering found');
      }
    } catch (offeringsErr) {
      console.log(`[RC DEBUG] Failed to fetch offerings: ${offeringsErr instanceof Error ? offeringsErr.message : String(offeringsErr)}`);
    }
  } catch (err) {
    console.log(`[RC DEBUG] Failed to get CustomerInfo: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log('╚═════════════════════════════════════════════════════════════════════╝');
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
      // Phase 1: offerings are not used yet. Avoid React Native redbox from
      // RevenueCat offering configuration logs — the native SDK auto-prefetches
      // offerings right after configure() and logs an ERROR if no products are
      // set up yet in the RevenueCat dashboard / App Store Connect. By default
      // react-native-purchases routes ERROR-level logs to console.error, which
      // triggers a dev redbox. We keep full visibility via console.warn instead,
      // without ever calling console.error for non-fatal RevenueCat logs.
      Purchases.setLogHandler((level, message) => {
        if (!__DEV__) return;
        console.warn(`[revenueCat:${level}] ${message}`);
      });
      Purchases.setLogLevel(LOG_LEVEL.WARN).catch(() => {/* non-fatal */});

      Purchases.configure({
        apiKey,
        appUserID: userId ?? undefined,
      });
      isConfigured = true;
      isLoggedIn = !!userId;
    } catch (err) {
      devWarn(`configure() failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  return configurePromise;
}

/**
 * Identifies the current Supabase user to RevenueCat via Purchases.logIn.
 * Returns true when the identity switch is confirmed to have succeeded (or
 * there was genuinely nothing to do — unsupported platform), false when a
 * real logIn attempt was made and failed. Callers (RevenueCatProvider,
 * syncRevenueCatUserAfterAuth) use this to decide whether the sync can be
 * considered durable or must be retried later. Never throws.
 */
export async function revenueCatLogIn(userId: string): Promise<boolean> {
  if (Platform.OS !== 'ios') return true;
  if (!isConfigured) {
    devWarn('logIn skipped — RevenueCat is not configured.');
    return false;
  }

  try {
    await Purchases.logIn(userId);
    isLoggedIn = true;
    return true;
  } catch (err) {
    devWarn(`logIn failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
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
  if (!isLoggedIn) return;

  try {
    await Purchases.logOut();
    isLoggedIn = false;
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

/**
 * Discriminated result returned by purchase/restore helpers below, so the UI
 * can branch on a stable shape instead of catching thrown errors everywhere.
 */
export type RevenueCatActionResult =
  | { ok: true; customerInfo: CustomerInfo }
  | { ok: false; reason: 'cancelled' | 'not_configured' | 'unsupported_platform' | 'unknown'; message?: string };

/**
 * Fetches all RevenueCat offerings. Intended to be called on demand from the
 * paywall screen only — never at app launch. Never throws.
 * Returns null if unavailable (unsupported platform, not configured, or the
 * native SDK failed to fetch offerings — e.g. products not ready yet on
 * App Store Connect).
 */
export async function getRevenueCatOfferings(): Promise<PurchasesOffering[] | null> {
  if (Platform.OS !== 'ios') return null;
  if (!isConfigured) {
    devWarn('getOfferings skipped — RevenueCat is not configured.');
    return null;
  }

  try {
    const offerings = await Purchases.getOfferings();
    return Object.values(offerings.all);
  } catch (err) {
    devWarn(`getOfferings failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Convenience wrapper: returns the "default" offering configured in the
 * RevenueCat dashboard, falling back to `current` if "default" isn't found.
 * Never throws.
 */
export async function getDefaultRevenueCatOffering(): Promise<PurchasesOffering | null> {
  if (Platform.OS !== 'ios') return null;
  if (!isConfigured) return null;

  try {
    const offerings = await Purchases.getOfferings();
    return offerings.all['default'] ?? offerings.current ?? null;
  } catch (err) {
    devWarn(`getDefaultOffering failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Pure helper: extracts the annual/monthly packages from an offering using
 * RevenueCat's predefined package type slots ($rc_annual / $rc_monthly).
 */
export function getZainlyPlusPackages(offering: PurchasesOffering | null | undefined): {
  annual: PurchasesPackage | null;
  monthly: PurchasesPackage | null;
} {
  if (!offering) return { annual: null, monthly: null };
  return {
    annual: offering.annual ?? null,
    monthly: offering.monthly ?? null,
  };
}

/**
 * Purchases a RevenueCat package (Phase 2). Never throws — returns a
 * discriminated result so the UI can branch cleanly without try/catch.
 * User cancellation is treated as a normal, non-error outcome.
 */
export async function purchaseRevenueCatPackage(
  packageToPurchase: PurchasesPackage
): Promise<RevenueCatActionResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, reason: 'unsupported_platform' };
  }
  if (!isConfigured) {
    devWarn('purchasePackage skipped — RevenueCat is not configured.');
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);

    if (__DEV__) {
      const currentAppUserId = await Purchases.getAppUserID().catch(() => 'unknown');
      console.log('[RC DEBUG] Purchase succeeded:', {
        productIdentifier: packageToPurchase.product.identifier,
        currentAppUserId,
        zainlyPlusActive: hasRevenueCatEntitlement(customerInfo, DEFAULT_ENTITLEMENT_ID),
        activeSubscriptions: customerInfo.activeSubscriptions,
        activeEntitlementIds: Object.keys(customerInfo.entitlements.active),
      });
    }

    return { ok: true, customerInfo };
  } catch (err: any) {
    const isCancelled =
      err?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || err?.userCancelled === true;

    if (isCancelled) {
      devWarn('purchasePackage: user cancelled.');
      return { ok: false, reason: 'cancelled' };
    }

    const message = err instanceof Error ? err.message : String(err);
    devWarn(`purchasePackage failed: ${message}`);
    return { ok: false, reason: 'unknown', message };
  }
}

/**
 * Restores previous purchases (Phase 2). Never throws — returns a
 * discriminated result so the UI can branch cleanly without try/catch.
 */
export async function restoreRevenueCatPurchases(): Promise<RevenueCatActionResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, reason: 'unsupported_platform' };
  }
  if (!isConfigured) {
    devWarn('restorePurchases skipped — RevenueCat is not configured.');
    return { ok: false, reason: 'not_configured' };
  }

  try {
    const customerInfo = await Purchases.restorePurchases();
    return { ok: true, customerInfo };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    devWarn(`restorePurchases failed: ${message}`);
    return { ok: false, reason: 'unknown', message };
  }
}

/**
 * Discriminated result returned by syncRevenueCatUserAfterAuth() below.
 * 'unsupported_platform' is not a failure — Zainly+ is iOS-only by design —
 * callers must treat it as "nothing to verify" and never block a free flow
 * on it. The other three reasons are real, potentially-retryable failures.
 */
export type RevenueCatAuthSyncResult =
  | { ok: true; entitlementActive: boolean; customerInfo: CustomerInfo | null }
  | {
      ok: false;
      reason: 'unsupported_platform' | 'configure_failed' | 'login_failed' | 'customer_info_failed';
      error?: unknown;
    };

/**
 * Explicitly (re)identifies the given Supabase userId to RevenueCat and
 * returns a verified, freshly-fetched entitlement snapshot. Intended to be
 * awaited right after a signup/login call resolves with an active session —
 * this is the exact moment a pre-auth anonymous purchase (made from the
 * onboarding paywall before an account existed) must be linked to the real
 * user, so any screen reading entitlement immediately after (e.g. the
 * dashboard) never races the identity switch.
 *
 * This is a thin composition of the existing configure/logIn/getCustomerInfo
 * primitives above — no second purchase/identity layer, no new state. Safe
 * to call multiple times for the same or different userId (configure is a
 * one-time no-op after the first call, logIn is idempotent). Never throws —
 * every failure mode is surfaced as a typed `ok: false` result instead, so
 * callers can decide whether to block (premium flows) or ignore (free
 * flows) without ever catching an exception. RevenueCat entitlement remains
 * the only source of truth: this function never invents a local premium
 * flag. The RevenueCatProvider's own reactive logIn (triggered by the
 * authStore user id changing) still runs independently and is unaffected by
 * this call.
 */
export async function syncRevenueCatUserAfterAuth(
  userId: string
): Promise<RevenueCatAuthSyncResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, reason: 'unsupported_platform' };
  }

  await configureRevenueCatOnce(userId);
  if (!isConfigured) {
    return { ok: false, reason: 'configure_failed' };
  }

  const loggedIn = await revenueCatLogIn(userId);
  if (!loggedIn) {
    return { ok: false, reason: 'login_failed' };
  }

  const customerInfo = await getRevenueCatCustomerInfo();
  if (!customerInfo) {
    return { ok: false, reason: 'customer_info_failed' };
  }

  return {
    ok: true,
    entitlementActive: hasRevenueCatEntitlement(customerInfo),
    customerInfo,
  };
}

export type { CustomerInfo, PurchasesOffering, PurchasesPackage };
