/**
 * The store, as the app understands it.
 *
 * Three things here are worth more than their line count. A cancelled purchase
 * must read as "cancelled" and not as a failure, or a learner who changed their
 * mind gets an error alert. A trial must only be promised when the store will
 * actually grant it — Apple allows one introductory offer per subscription group
 * per Apple ID, and promising it anyway is a review rejection. And the length of
 * that trial comes from the store's own offer rather than from a number typed
 * into the copy.
 */

import Purchases, { PURCHASES_ERROR_CODE } from 'react-native-purchases';
import { Platform } from 'react-native';

jest.mock('@/lib/backend_mode', () => ({ USES_LOCAL_BACKEND: false }));

const purchases = Purchases as unknown as Record<string, jest.Mock>;

/**
 * A fresh copy of the service.
 *
 * The API key is read at import time and `configured` is module state, so each
 * test needs its own copy rather than whatever the last one left behind.
 */
function load(): typeof import('@/services/purchases_service') {
  let module!: typeof import('@/services/purchases_service');
  jest.isolateModules(() => {
    module = require('@/services/purchases_service');
  });
  return module;
}

/** Loaded with a key present, and configured, so it behaves like a real build. */
async function loadConfigured() {
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  const service = load();
  await service.configurePurchases('learner-1');
  return service;
}

/** ...and without one, which is what a build with no store looks like. */
async function loadUnconfigured() {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  return load();
}

function customerInfo(entitlement?: Partial<Record<string, unknown>>) {
  return {
    entitlements: { active: entitlement ? { pro: entitlement } : {} },
    managementURL: 'https://apps.apple.com/account/subscriptions',
    originalAppUserId: 'learner-1',
  } as never;
}

function subscriptionPackage(introPrice: unknown) {
  return { product: { priceString: '₺149,99', introPrice } } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  purchases.getCustomerInfo.mockResolvedValue(customerInfo());
});

describe('what the app is told it owns', () => {
  it('reads an active entitlement, including whether it is still the trial', async () => {
    const service = await loadConfigured();
    purchases.getCustomerInfo.mockResolvedValue(
      customerInfo({
        periodType: 'TRIAL',
        productIdentifier: 'codeling_pro_monthly',
        expirationDate: '2099-01-01T00:00:00Z',
        willRenew: true,
      })
    );

    expect(await service.getSubscriptionSnapshot()).toEqual({
      isSubscribed: true,
      isTrial: true,
      productId: 'codeling_pro_monthly',
      expiresAt: '2099-01-01T00:00:00Z',
      willRenew: true,
      managementUrl: 'https://apps.apple.com/account/subscriptions',
      appUserId: 'learner-1',
    });
  });

  it('reads no entitlement as the free plan rather than as an error', async () => {
    const service = await loadConfigured();

    expect(await service.getSubscriptionSnapshot()).toMatchObject({
      isSubscribed: false,
      isTrial: false,
      productId: null,
    });
  });

  it('answers nothing at all when the store never came up', async () => {
    const service = await loadUnconfigured();

    expect(service.isPurchasesAvailable()).toBe(false);
    expect(await service.getSubscriptionSnapshot()).toBeNull();
    expect(await service.getCurrentOffering()).toBeNull();
  });

  it('keeps the app running when the store throws on the way in', async () => {
    const service = await loadConfigured();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    purchases.getCustomerInfo.mockRejectedValue(new Error('network'));

    expect(await service.getSubscriptionSnapshot()).toBeNull();
    warn.mockRestore();
  });
});

describe('buying', () => {
  it('comes back with the entitlement the purchase granted', async () => {
    const service = await loadConfigured();
    purchases.purchasePackage = jest.fn(async () => ({
      customerInfo: customerInfo({ productIdentifier: 'codeling_pro_annual', willRenew: true }),
    }));

    const outcome = await service.purchase(subscriptionPackage(null));

    expect(outcome).toMatchObject({ status: 'purchased' });
    expect(outcome.status === 'purchased' && outcome.snapshot.isSubscribed).toBe(true);
  });

  it.each([
    ['the flag the SDK sets', { userCancelled: true }],
    ['the code as a string', { code: '1' }],
    // The native bridge sometimes hands the same code back as a number.
    ['the code as a number', { code: 1 }],
  ])('treats a learner changing their mind as cancelled, by %s', async (_name, error) => {
    const service = await loadConfigured();
    purchases.purchasePackage = jest.fn(async () => {
      throw error;
    });

    expect(await service.purchase(subscriptionPackage(null))).toEqual({ status: 'cancelled' });
    expect(String(PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)).toBe('1');
  });

  it('reports a store that refused as a failure the screen can explain', async () => {
    const service = await loadConfigured();
    purchases.purchasePackage = jest.fn(async () => {
      throw { code: '2', message: 'Store is unavailable' };
    });

    const failure = await service.purchase(subscriptionPackage(null)).catch((error) => error);

    // Matched by shape, not by class: the isolated copy of the service carries
    // its own copy of AppError.
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ code: 'store_unavailable', message: 'Store is unavailable' });
  });

  it('refuses to pretend it can sell anything without a store', async () => {
    const service = await loadUnconfigured();

    await expect(service.purchase(subscriptionPackage(null))).rejects.toMatchObject({
      code: 'store_unavailable',
    });
    await expect(service.restore()).rejects.toMatchObject({ code: 'store_unavailable' });
  });
});

describe('the free trial', () => {
  it('is promised only for the products this Apple ID may still take', async () => {
    const service = await loadConfigured();
    purchases.checkTrialOrIntroductoryPriceEligibility = jest.fn(async () => ({
      monthly: { status: 2 },
      annual: { status: 1 },
    }));

    expect(await service.checkTrialEligibility(['monthly', 'annual'])).toEqual({
      monthly: true,
      annual: false,
    });
  });

  it('is not promised when the store cannot say', async () => {
    const service = await loadConfigured();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    purchases.checkTrialOrIntroductoryPriceEligibility = jest.fn(async () => {
      throw new Error('offline');
    });

    // Unknown is treated as ineligible: promising an offer Apple then refuses is
    // a rejection risk, and a plain price is never wrong.
    expect(await service.checkTrialEligibility(['monthly'])).toEqual({ monthly: false });
    warn.mockRestore();
  });

  it('is not asked about on Android, where the answer is always unknown', async () => {
    const service = await loadConfigured();
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    purchases.checkTrialOrIntroductoryPriceEligibility = jest.fn();

    expect(await service.checkTrialEligibility(['monthly'])).toEqual({ monthly: false });
    expect(purchases.checkTrialOrIntroductoryPriceEligibility).not.toHaveBeenCalled();
  });

  it.each([
    [{ price: 0, periodUnit: 'DAY', periodNumberOfUnits: 3 }, 3],
    [{ price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1 }, 7],
    [{ price: 0, periodUnit: 'MONTH', periodNumberOfUnits: 1 }, 30],
    [{ price: 0, periodUnit: 'YEAR', periodNumberOfUnits: 1 }, 365],
    // A paid introductory offer is not a free trial, whatever its length.
    [{ price: 4.99, periodUnit: 'MONTH', periodNumberOfUnits: 1 }, null],
    [null, null],
  ])('takes its length from the store: %p', async (introPrice, expected) => {
    const service = await loadConfigured();

    expect(service.packageTrialDays(subscriptionPackage(introPrice))).toBe(expected);
  });
});
