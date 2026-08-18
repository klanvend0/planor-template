/**
 * RevenueCat wrapper.
 *
 * All StoreKit traffic goes through here so screens never import the SDK
 * directly. Every export is safe to call when RevenueCat is not configured —
 * no API key in `.env`, Expo Go, or a simulator without StoreKit — in which case
 * the app simply behaves as if the learner has no subscription instead of
 * crashing.
 *
 * @module services/purchases_service
 */

import { Platform } from 'react-native';
import Purchases, {
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

/** True when a RevenueCat API key was provided for this platform. */
export function isPurchasesAvailable(): boolean {
  const key = Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
  return typeof key === 'string' && key.length > 0;
}

/** True once {@link configurePurchases} has run successfully. */
export function isPurchasesConfigured(): boolean {
  return configured;
}

/**
 * Configure the SDK. Idempotent, and a no-op without an API key.
 *
 * @param appUserId - The Supabase user id, so RevenueCat and Postgres agree on
 * who owns an entitlement. Omit before sign-in to use an anonymous id.
 */
export async function configurePurchases(appUserId?: string): Promise<void> {
  if (configured || !isPurchasesAvailable()) return;

  const apiKey = (Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY) as string;

  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
    await Purchases.configure({ apiKey, appUserID: appUserId ?? null });
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
    await Purchases.logOut();
  } catch (error) {
    // Logging out an already-anonymous user throws; that is not a failure.
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
export function onSubscriptionChange(listener: (snapshot: SubscriptionSnapshot) => void): () => void {
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
  | { status: 'purchased'; snapshot: SubscriptionSnapshot }
  | { status: 'cancelled' };

/**
 * Buy a package.
 *
 * @throws {AppError} `store_unavailable` when StoreKit refuses the purchase.
 */
export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  if (!configured) throw new AppError('store_unavailable', 'RevenueCat is not configured');

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', snapshot: toSnapshot(customerInfo) };
  } catch (error) {
    const rcError = error as { userCancelled?: boolean; code?: string; message?: string };
    if (rcError.userCancelled || rcError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { status: 'cancelled' };
    }
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
 * Whether the store will grant an introductory offer (our 3 free days) for these
 * products. Apple only allows one intro offer per subscription group per Apple ID,
 * so the paywall must not promise a trial the learner cannot get.
 *
 * @param productIds - Store product identifiers from the current offering.
 * @returns Map of product id to eligibility; unknown products default to eligible.
 */
export async function checkTrialEligibility(productIds: string[]): Promise<Record<string, boolean>> {
  const fallback = Object.fromEntries(productIds.map((id) => [id, true]));
  if (!configured || productIds.length === 0) return fallback;

  try {
    const result = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds);
    return Object.fromEntries(
      productIds.map((id) => {
        const status = result[id]?.status;
        // 1 = INELIGIBLE, 2 = ELIGIBLE, 0 = UNKNOWN; treat unknown as eligible so
        // the copy stays optimistic and StoreKit has the final word at checkout.
        return [id, status !== 1];
      })
    );
  } catch (error) {
    console.warn('[purchases] eligibility check failed', error);
    return fallback;
  }
}

/** Price of a package as the store formatted it, e.g. "₺149,99". */
export function packagePrice(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}
