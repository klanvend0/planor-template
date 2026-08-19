/**
 * The store, without a store.
 *
 * With no RevenueCat key there is nothing to fetch an offering from and nothing
 * to buy from, which would leave the paywall — the screen this app is built
 * around — impossible to look at, let alone test. So the packages are built
 * here from the same shape RevenueCat returns, and "buying" writes an
 * entitlement into the device's own document.
 *
 * The paywall says plainly that no payment is taken; see `paywall.local_notice`.
 * None of this is reachable once `EXPO_PUBLIC_SUPABASE_URL` is set, because
 * that is what decides whether the app has a backend at all.
 *
 * @module services/local/store
 */

import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { DEFAULT_OFFERING_ID, ENTITLEMENT_ID, TRIAL_DAYS } from '@/lib/constants';
import { grantSubscription, readSubscription } from '@/services/local/backend';
import { mutateDocument, readDocument } from '@/services/local/document';
import type { SubscriptionSnapshot } from '@/services/purchases_service';

const DAY_MS = 86_400_000;

type LocalPlan = {
  identifier: string;
  packageType: 'MONTHLY' | 'ANNUAL';
  productId: string;
  price: number;
  priceString: string;
  /** ISO 8601 duration, exactly as a store reports it. */
  period: string;
  months: number;
  withTrial: boolean;
};

const PLANS: LocalPlan[] = [
  {
    identifier: '$rc_monthly',
    packageType: 'MONTHLY',
    productId: 'codeling.pro.monthly',
    price: 4.99,
    priceString: '$4.99',
    period: 'P1M',
    months: 1,
    withTrial: false,
  },
  {
    identifier: '$rc_annual',
    packageType: 'ANNUAL',
    productId: 'codeling.pro.annual',
    price: 29.99,
    priceString: '$29.99',
    period: 'P1Y',
    months: 12,
    withTrial: true,
  },
];

/**
 * Build one package.
 *
 * `PurchasesStoreProduct` carries three dozen fields a store fills in; the
 * paywall reads six of them. Rather than invent values for the rest, the object
 * is asserted once, here, where the reason is visible.
 */
function toPackage(plan: LocalPlan): PurchasesPackage {
  const product = {
    identifier: plan.productId,
    title: 'Codeling Pro',
    description: 'Everything unlocked',
    price: plan.price,
    priceString: plan.priceString,
    currencyCode: 'USD',
    subscriptionPeriod: plan.period,
    introPrice: plan.withTrial
      ? {
          identifier: `${plan.productId}.trial`,
          price: 0,
          priceString: 'Free',
          cycles: 1,
          period: `P${TRIAL_DAYS}D`,
          periodUnit: 'DAY',
          periodNumberOfUnits: TRIAL_DAYS,
        }
      : null,
  };

  return {
    identifier: plan.identifier,
    packageType: plan.packageType,
    product,
    offeringIdentifier: DEFAULT_OFFERING_ID,
    presentedOfferingContext: {
      offeringIdentifier: DEFAULT_OFFERING_ID,
      placementIdentifier: null,
      targetingContext: null,
    },
    webCheckoutUrl: null,
  } as unknown as PurchasesPackage;
}

const PACKAGES = PLANS.map(toPackage);

export function localOffering(): PurchasesOffering {
  return {
    identifier: DEFAULT_OFFERING_ID,
    serverDescription: 'On-device offering',
    metadata: {},
    availablePackages: PACKAGES,
    lifetime: null,
    annual: PACKAGES[1] ?? null,
    sixMonth: null,
    threeMonth: null,
    twoMonth: null,
    monthly: PACKAGES[0] ?? null,
    weekly: null,
  } as unknown as PurchasesOffering;
}

function snapshotOf(
  subscription: {
    productId: string;
    expiresAt: string;
    isTrial: boolean;
    willRenew: boolean;
  } | null
): SubscriptionSnapshot {
  return {
    isSubscribed: !!subscription,
    isTrial: subscription?.isTrial ?? false,
    productId: subscription?.productId ?? null,
    expiresAt: subscription?.expiresAt ?? null,
    willRenew: subscription?.willRenew ?? false,
    // There is no App Store subscription to manage.
    managementUrl: null,
    appUserId: null,
  };
}

const listeners = new Set<(snapshot: SubscriptionSnapshot) => void>();

export function onLocalSubscriptionChange(
  listener: (snapshot: SubscriptionSnapshot) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function localSnapshot(): Promise<SubscriptionSnapshot> {
  return snapshotOf(await readSubscription());
}

/** Which products still have their introductory offer available. */
export async function localTrialEligibility(
  productIds: string[]
): Promise<Record<string, boolean>> {
  const document = await readDocument();
  const used = !!document.trialUsedAt;
  const withTrial = new Set(PLANS.filter((plan) => plan.withTrial).map((plan) => plan.productId));

  return Object.fromEntries(
    productIds.map((productId) => [productId, !used && withTrial.has(productId)])
  );
}

/**
 * "Buy" a package: no money moves, an entitlement is written to the device.
 *
 * The period is the one the package advertises, so a trial really does last
 * {@link TRIAL_DAYS} days and really does end.
 */
export async function localPurchase(pkg: PurchasesPackage): Promise<SubscriptionSnapshot> {
  const plan = PLANS.find((entry) => entry.productId === pkg.product.identifier) ?? PLANS[0];
  const document = await readDocument();
  const onTrial = plan.withTrial && !document.trialUsedAt;

  const now = Date.now();
  const expiresAt = new Date(
    onTrial ? now + TRIAL_DAYS * DAY_MS : now + plan.months * 30 * DAY_MS
  ).toISOString();

  await grantSubscription({
    productId: plan.productId,
    expiresAt,
    isTrial: onTrial,
    willRenew: true,
  });

  if (onTrial) {
    await mutateDocument((current) => {
      current.trialUsedAt = new Date(now).toISOString();
    });
  }

  const snapshot = snapshotOf({
    productId: plan.productId,
    expiresAt,
    isTrial: onTrial,
    willRenew: true,
  });
  for (const listener of listeners) listener(snapshot);
  return snapshot;
}

/** The entitlement id the rest of the app checks, kept in one place. */
export const LOCAL_ENTITLEMENT = ENTITLEMENT_ID;
