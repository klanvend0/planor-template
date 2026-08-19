/**
 * The paywall's data when there is no store behind it.
 *
 * The screen this app is built around has to be reachable in a fresh clone, and
 * what it shows has to be true: the trial is offered once, lasts the days it
 * says, and really expires.
 */

import { TRIAL_DAYS } from '@/lib/constants';
import { fetchGameState, signIn } from '@/services/local/backend';
import { resetDocument } from '@/services/local/document';
import {
  localOffering,
  localPurchase,
  localSnapshot,
  localTrialEligibility,
} from '@/services/local/store';

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDocument();
  await signIn();
});

describe('the local offering', () => {
  it('sells a monthly and an annual plan, with the trial on the annual one', () => {
    const offering = localOffering();
    expect(offering.availablePackages.map((pkg) => pkg.packageType)).toEqual(['MONTHLY', 'ANNUAL']);

    const annual = offering.availablePackages[1];
    expect(annual.product.subscriptionPeriod).toBe('P1Y');
    expect(annual.product.introPrice?.price).toBe(0);
    expect(annual.product.introPrice?.periodNumberOfUnits).toBe(TRIAL_DAYS);
  });

  it('prices every package, so the paywall never shows a blank', () => {
    for (const pkg of localOffering().availablePackages) {
      expect(pkg.product.priceString).toMatch(/\d/);
      expect(pkg.product.identifier).toContain('codeling');
    }
  });
});

describe('buying', () => {
  it('starts nobody off subscribed', async () => {
    expect((await localSnapshot()).isSubscribed).toBe(false);
    expect((await fetchGameState()).hasSubscription).toBe(false);
  });

  it('unlocks Pro for the trial period and reports it everywhere', async () => {
    const annual = localOffering().availablePackages[1];
    const snapshot = await localPurchase(annual);

    expect(snapshot.isSubscribed).toBe(true);
    expect(snapshot.isTrial).toBe(true);
    expect((await fetchGameState()).hasSubscription).toBe(true);

    const daysLeft = (Date.parse(snapshot.expiresAt!) - Date.now()) / DAY;
    expect(Math.round(daysLeft)).toBe(TRIAL_DAYS);
  });

  it('offers the trial once, exactly as a store does', async () => {
    const annual = localOffering().availablePackages[1];
    const productIds = localOffering().availablePackages.map((pkg) => pkg.product.identifier);

    expect(await localTrialEligibility(productIds)).toMatchObject({
      'codeling.pro.annual': true,
      // The monthly plan never carried an introductory offer.
      'codeling.pro.monthly': false,
    });

    await localPurchase(annual);
    expect(await localTrialEligibility(productIds)).toMatchObject({
      'codeling.pro.annual': false,
    });
  });

  it('charges the plan period once the trial has been used', async () => {
    const [monthly, annual] = localOffering().availablePackages;
    await localPurchase(annual);

    const second = await localPurchase(monthly);
    expect(second.isTrial).toBe(false);
    const daysLeft = (Date.parse(second.expiresAt!) - Date.now()) / DAY;
    expect(Math.round(daysLeft)).toBe(30);
  });

  it('restores what the device already has', async () => {
    await localPurchase(localOffering().availablePackages[0]);
    expect((await localSnapshot()).isSubscribed).toBe(true);
  });
});
