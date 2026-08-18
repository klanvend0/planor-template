/**
 * RevenueCat wrapper.
 *
 * All StoreKit traffic goes through here so screens never import the SDK
 * directly. Every export is safe to call when RevenueCat is unavailable — no API
 * key in `.env`, or running inside Expo Go — in which case the app behaves as if
 * the learner simply has no subscription instead of crashing.
 *
 * Two facts about `react-native-purchases@10` shape this file:
 * - There is no Expo config plugin. It is an ordinary autolinked native module,
 *   so it needs a development build; do not add it to `app.json` → `plugins`.
 * - Inside Expo Go `configure()` *throws* for any key that is not a Test Store
 *   key (`test_`/`rcb_`), so configuration is skipped there rather than attempted.
 *
 * @module services/purchases_service
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

import { AppError } from '@/lib/errors';
import { DEFAULT_OFFERING_ID, ENTITLEMENT_ID } from '@/lib/constants';

export type SubscriptionSnapshot = {
  isSubscribed: boolean;
  /** True while the learner is inside the introductory free trial. */
  isTrial: boolean;
  productId: string | null;
  /** ISO date the current period ends, when the store reports one. */
  expiresAt: string | null;
  willRenew: boolean;
  managementUrl: string | null;
  /** RevenueCat's id for this learner, mirrored into Postgres by the webhook. */
  appUserId: string | null;
};

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

let configured = false;

function apiKey(): string | undefined {
  return Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
}

/** Expo Go cannot load the native module; only Test Store keys work there. */
function blockedByExpoGo(key: string): boolean {
  const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return inExpoGo && !key.startsWith('test_') && !key.startsWith('rcb_');
}

/** True when a usable RevenueCat API key exists for this build. */
export function isPurchasesAvailable(): boolean {
  const key = apiKey();
  return typeof key === 'string' && key.length > 0 && !blockedByExpoGo(key);
}

/** True once {@link configurePurchases} has run successfully. */
export function isPurchasesConfigured(): boolean {
  return configured;
}

/**
 * Configure the SDK. Idempotent, and a no-op when purchases are unavailable.
 *
 * @param appUserId - The Supabase user id, so RevenueCat and Postgres agree on
 * who owns an entitlement. Omit before sign-in to use an anonymous id. Never
 * pass an email: it leaks into webhooks and exports and changes over time.
 */
export async function configurePurchases(appUserId?: string): Promise<void> {
  if (configured || !isPurchasesAvailable()) return;

  try {
    if (__DEV__) await Purchases.setLogLevel(LOG_LEVEL.WARN);
    // configure() is synchronous in v10 and throws on a bad key.
    Purchases.configure({ apiKey: apiKey() as string, appUserID: appUserId ?? null });
    configured = true;
  } catch (error) {
    // A failed configure must never block the app; the paywall degrades instead.
    console.warn('[purchases] configure failed', error);
  }
}

/** Attach the store account to a Supabase user after sign-in. */
export async function identifyUser(appUserId: string): Promise<SubscriptionSnapshot | null> {
  if (!configured) {
    await configurePurchases(appUserId);
    if (!configured) return null;
  }
  try {
    const { customerInfo } = await Purchases.logIn(appUserId);
    return toSnapshot(customerInfo);
  } catch (error) {
    console.warn('[purchases] logIn failed', error);
    return null;
  }
}

/** Detach the store account on sign-out, returning to an anonymous id. */
export async function forgetUser(): Promise<void> {
  if (!configured) return;
  try {
    // logOut() throws when the current id is already anonymous.
    if (await Purchases.isAnonymous()) return;
    await Purchases.logOut();
  } catch (error) {
    console.warn('[purchases] logOut skipped', error);
  }
}

/** Map RevenueCat's customer info onto the shape the app reasons about. */
export function toSnapshot(info: CustomerInfo): SubscriptionSnapshot {
  const entitlement = info.entitlements.active[ENTITLEMENT_ID];
  return {
    isSubscribed: !!entitlement,
    isTrial: entitlement?.periodType === 'TRIAL',
    productId: entitlement?.productIdentifier ?? null,
    expiresAt: entitlement?.expirationDate ?? null,
    willRenew: entitlement?.willRenew ?? false,
    managementUrl: info.managementURL ?? null,
    appUserId: info.originalAppUserId ?? null,
  };
}

/** Current entitlement state, or null when purchases are unavailable. */
export async function getSubscriptionSnapshot(): Promise<SubscriptionSnapshot | null> {
  if (!configured) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    return toSnapshot(info);
  } catch (error) {
    console.warn('[purchases] getCustomerInfo failed', error);
    return null;
  }
}

/** Subscribe to entitlement changes (renewals, expirations, cross-device buys). */
export function onSubscriptionChange(
  listener: (snapshot: SubscriptionSnapshot) => void
): () => void {
  if (!configured) return () => {};

  const handler = (info: CustomerInfo) => listener(toSnapshot(info));
  Purchases.addCustomerInfoUpdateListener(handler);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(handler);
  };
}

/** The offering the paywall renders, or null when the store is unreachable. */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? offerings.all[DEFAULT_OFFERING_ID] ?? null;
  } catch (error) {
    console.warn('[purchases] getOfferings failed', error);
    return null;
  }
}

export type PurchaseOutcome =
  { status: 'purchased'; snapshot: SubscriptionSnapshot } | { status: 'cancelled' };

/**
 * Buy a package.
 *
 * A user cancelling is a normal outcome, not an error, so it comes back as
 * `cancelled` rather than throwing.
 *
 * @throws {AppError} `store_unavailable` when StoreKit refuses the purchase.
 */
export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!configured) throw new AppError('store_unavailable', 'RevenueCat is not configured');

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', snapshot: toSnapshot(customerInfo) };
  } catch (error) {
    const rcError = error as { userCancelled?: boolean; code?: string | number; message?: string };
    // PURCHASES_ERROR_CODE members are string enums holding numeric strings, and
    // the native bridge sometimes hands back a number — compare as strings.
    const cancelled =
      rcError.userCancelled === true ||
      String(rcError.code) === String(PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR);
    if (cancelled) return { status: 'cancelled' };
    throw new AppError('store_unavailable', rcError.message ?? 'Purchase failed', error);
  }
}

/**
 * Restore previous purchases — required on any screen that sells a subscription.
 *
 * @returns The entitlement state after restoring, or null when unavailable.
 */
export async function restore(): Promise<SubscriptionSnapshot | null> {
  if (!configured) throw new AppError('store_unavailable', 'RevenueCat is not configured');
  const info = await Purchases.restorePurchases();
  return toSnapshot(info);
}

/**
 * Whether the store will actually grant the 3 free days for these products.
 *
 * Apple allows one introductory offer per subscription *group* per Apple ID, so
 * the paywall must not promise a trial the learner cannot get — that is an App
 * Review rejection risk. Unknown eligibility is therefore treated as ineligible
 * and the plain price is shown.
 *
 * iOS only: Android always reports UNKNOWN, so trial copy there comes from the
 * product's own free phase instead.
 *
 * @param productIds - Store product identifiers from the current offering.
 * @returns Map of product id to eligibility.
 */
export async function checkTrialEligibility(
  productIds: string[]
): Promise<Record<string, boolean>> {
  const unknown = Object.fromEntries(productIds.map((id) => [id, false]));
  if (!configured || productIds.length === 0) return unknown;

  if (Platform.OS !== 'ios') {
    // On Android the free phase is described by the product itself.
    return unknown;
  }

  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
    return Object.fromEntries(
      productIds.map((id) => [
        id,
        result[id]?.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE,
      ])
    );
  } catch (error) {
    console.warn('[purchases] eligibility check failed', error);
    return unknown;
  }
}

/** Price of a package as the store formatted it, e.g. "₺149,99". */
export function packagePrice(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}

/**
 * The free-trial length the store reports for a package, in days.
 *
 * Used on Android (and as a cross-check on iOS) so the paywall describes the
 * offer the store will actually apply rather than a hardcoded promise.
 */
export function packageTrialDays(pkg: PurchasesPackage): number | null {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return null;

  switch (intro.periodUnit) {
    case 'DAY':
      return intro.periodNumberOfUnits;
    case 'WEEK':
      return intro.periodNumberOfUnits * 7;
    case 'MONTH':
      return intro.periodNumberOfUnits * 30;
    case 'YEAR':
      return intro.periodNumberOfUnits * 365;
    default:
      return null;
  }
}
