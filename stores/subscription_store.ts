/**
 * Subscription state.
 *
 * The app's single answer to "is this learner Pro?". RevenueCat is the source of
 * truth on device; the Postgres mirror written by the webhook is what the AI
 * grading edge function trusts. Both agree because they key off the same
 * Supabase user id.
 *
 * @module stores/subscription_store
 */

import { create } from 'zustand';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { toAppError, type AppError } from '@/lib/errors';
import {
  checkTrialEligibility,
  configurePurchases,
  forgetUser,
  getCurrentOffering,
  getSubscriptionSnapshot,
  identifyUser,
  isPurchasesAvailable,
  onSubscriptionChange,
  purchase as purchasePackage,
  restore as restorePurchases,
  type SubscriptionSnapshot,
} from '@/services/purchases_service';
import { syncSubscription } from '@/services/subscription_service';
import { useGameStore } from '@/stores/game_store';

type SubscriptionStoreState = {
  snapshot: SubscriptionSnapshot | null;
  offering: PurchasesOffering | null;
  /** Product id to trial eligibility, so the CTA never promises a lost trial. */
  trialEligibility: Record<string, boolean>;
  isReady: boolean;
  isLoadingOffering: boolean;
  isPurchasing: boolean;
  isRestoring: boolean;
  error: AppError | null;
  /** False when no RevenueCat key is configured for this build. */
  storeAvailable: boolean;
};

type SubscriptionStoreActions = {
  initialize: (appUserId?: string) => Promise<void>;
  identify: (appUserId: string) => Promise<void>;
  signOut: () => Promise<void>;
  loadOffering: () => Promise<void>;
  buy: (pkg: PurchasesPackage) => Promise<'purchased' | 'cancelled'>;
  restore: () => Promise<boolean>;
  clearError: () => void;
};

let unsubscribeListener: (() => void) | null = null;

/** Keep every consumer of "is Pro" in sync from one place. */
function publish(snapshot: SubscriptionSnapshot | null): void {
  useGameStore.getState().setSubscribed(snapshot?.isSubscribed ?? false);
}

export const useSubscriptionStore = create<SubscriptionStoreState & SubscriptionStoreActions>(
  (set, get) => ({
    snapshot: null,
    offering: null,
    trialEligibility: {},
    isReady: false,
    isLoadingOffering: false,
    isPurchasing: false,
    isRestoring: false,
    error: null,
    storeAvailable: isPurchasesAvailable(),

    initialize: async (appUserId) => {
      await configurePurchases(appUserId);

      unsubscribeListener?.();
      unsubscribeListener = onSubscriptionChange((snapshot) => {
        set({ snapshot });
        publish(snapshot);
      });

      const snapshot = await getSubscriptionSnapshot();
      set({ snapshot, isReady: true });
      publish(snapshot);

      void get().loadOffering();
    },

    identify: async (appUserId) => {
      const snapshot = await identifyUser(appUserId);
      if (snapshot) {
        set({ snapshot });
        publish(snapshot);
      }
    },

    signOut: async () => {
      await forgetUser();
      set({ snapshot: null });
      publish(null);
    },

    loadOffering: async () => {
      if (get().isLoadingOffering) return;
      set({ isLoadingOffering: true });
      try {
        const offering = await getCurrentOffering();
        const productIds = offering?.availablePackages.map((pkg) => pkg.product.identifier) ?? [];
        const trialEligibility = await checkTrialEligibility(productIds);
        set({ offering, trialEligibility, isLoadingOffering: false });
      } catch (error) {
        set({ isLoadingOffering: false, error: toAppError(error, 'store_unavailable') });
      }
    },

    buy: async (pkg) => {
      set({ isPurchasing: true, error: null });
      try {
        const outcome = await purchasePackage(pkg);
        if (outcome.status === 'purchased') {
          set({ snapshot: outcome.snapshot, isPurchasing: false });
          publish(outcome.snapshot);
          // The UI is unlocked by the snapshot above, but the server reads its
          // own mirror. Close that gap before the learner tries to use what
          // they just bought; if it fails, the webhook is still coming.
          await syncSubscription();
          await useGameStore.getState().refresh({ silent: true });
          return 'purchased';
        }
        set({ isPurchasing: false });
        return 'cancelled';
      } catch (error) {
        set({ isPurchasing: false, error: toAppError(error, 'store_unavailable') });
        throw error;
      }
    },

    restore: async () => {
      set({ isRestoring: true, error: null });
      try {
        const snapshot = await restorePurchases();
        set({ snapshot, isRestoring: false });
        publish(snapshot);
        if (snapshot?.isSubscribed) {
          await syncSubscription();
          await useGameStore.getState().refresh({ silent: true });
        }
        return snapshot?.isSubscribed ?? false;
      } catch (error) {
        set({ isRestoring: false, error: toAppError(error, 'store_unavailable') });
        throw error;
      }
    },

    clearError: () => set({ error: null }),
  })
);

/** True when the learner currently holds the Pro entitlement. */
export const selectIsPro = (state: SubscriptionStoreState): boolean =>
  state.snapshot?.isSubscribed ?? false;
