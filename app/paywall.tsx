/**
 * Paywall.
 *
 * Hardcoded in the binary rather than driven by a remote config, because App
 * Store review must be able to see the full disclosure set even if the network
 * is unhelpful: subscription title, length, price per period, exactly what the
 * free trial does, links to the Terms of Use and Privacy Policy, and Restore
 * Purchases (Guidelines 3.1.1 and 3.1.2, Schedule 2 §3.8(b)).
 *
 * The trial line only promises free days when the store confirms the learner is
 * eligible — Apple grants one introductory offer per subscription group.
 *
 * @module app/paywall
 */

import { router } from 'expo-router';
import { Check, Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { Kicker } from '@/components/kicker';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { track } from '@/lib/analytics';
import { LINKS, TRIAL_DAYS } from '@/lib/constants';
import { USES_LOCAL_BACKEND } from '@/lib/backend_mode';
import { AppError, errorMessageKey } from '@/lib/errors';
import { localeUpper } from '@/lib/i18n';
import { openExternal } from '@/lib/links';
import { packageTrialDays } from '@/services/purchases_service';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings_store';
import { useSubscriptionStore } from '@/stores/subscription_store';

const FEATURES = ['ai', 'hearts', 'courses', 'practice', 'support'] as const;

/**
 * How often a package bills.
 *
 * `other` is the honest answer for a package whose period cannot be read: the
 * screen then shows the price with no period claim at all, because a wrong one
 * ("/ month" on a six-month plan) is exactly what Guideline 3.1.2 rejects.
 */
type BillingPeriod =
  'week' | 'month' | 'two_month' | 'three_month' | 'six_month' | 'year' | 'once' | 'other';

/** RevenueCat reports the period as an ISO 8601 duration: P1W, P3M, P1Y. */
function periodFromIso(iso: string | null | undefined): BillingPeriod {
  // No subscription period at all means a one-off product, not an unknown one.
  if (!iso) return 'once';
  const match = /^P(\d+)([DWMY])$/.exec(iso);
  if (!match) return 'other';
  const count = Number(match[1]);
  switch (match[2]) {
    case 'D':
      return count === 7 ? 'week' : 'other';
    case 'W':
      return count === 1 ? 'week' : 'other';
    case 'M':
      if (count === 1) return 'month';
      if (count === 2) return 'two_month';
      if (count === 3) return 'three_month';
      if (count === 6) return 'six_month';
      if (count === 12) return 'year';
      return 'other';
    case 'Y':
      return count === 1 ? 'year' : 'other';
    default:
      return 'other';
  }
}

/**
 * The billing period of a package.
 *
 * RevenueCat's own `packageType` covers the standard durations; `CUSTOM` and
 * `UNKNOWN` are whatever the offering was configured with, so those fall back to
 * the product's subscription period.
 */
function billingPeriod(pkg: PurchasesPackage): BillingPeriod {
  switch (pkg.packageType) {
    case 'WEEKLY':
      return 'week';
    case 'MONTHLY':
      return 'month';
    case 'TWO_MONTH':
      return 'two_month';
    case 'THREE_MONTH':
      return 'three_month';
    case 'SIX_MONTH':
      return 'six_month';
    case 'ANNUAL':
      return 'year';
    case 'LIFETIME':
      return 'once';
    default:
      return periodFromIso(pkg.product.subscriptionPeriod);
  }
}

const PLAN_LABEL_KEYS = {
  week: 'paywall.plan_weekly',
  month: 'paywall.plan_monthly',
  two_month: 'paywall.plan_two_month',
  three_month: 'paywall.plan_three_month',
  six_month: 'paywall.plan_six_month',
  year: 'paywall.plan_annual',
  once: 'paywall.plan_lifetime',
  other: 'paywall.plan_other',
} as const;

const PRICE_KEYS = {
  week: 'paywall.per_week',
  month: 'paywall.per_month',
  two_month: 'paywall.per_two_month',
  three_month: 'paywall.per_three_month',
  six_month: 'paywall.per_six_month',
  year: 'paywall.per_year',
  once: 'paywall.per_once',
} as const;

/** Human label for a package, from the store's own period. */
function planLabelKey(pkg: PurchasesPackage): (typeof PLAN_LABEL_KEYS)[BillingPeriod] {
  return PLAN_LABEL_KEYS[billingPeriod(pkg)];
}

/**
 * The billed amount, written the way the store bills it.
 *
 * A package whose period cannot be determined shows the bare price rather than
 * a period this app made up.
 */
function priceLine(pkg: PurchasesPackage, t: ReturnType<typeof useTranslation>['t']): string {
  const period = billingPeriod(pkg);
  if (period === 'other') return pkg.product.priceString;
  return t(PRICE_KEYS[period], { price: pkg.product.priceString });
}

export default function PaywallScreen() {
  const { t, locale } = useTranslation();
  const insets = useSafeAreaInsets();
  const markPaywallSeen = useSettingsStore((state) => state.markPaywallSeen);

  const {
    offering,
    snapshot,
    trialEligibility,
    isLoadingOffering,
    isPurchasing,
    isRestoring,
    storeAvailable,
    loadOffering,
    buy,
    restore,
  } = useSubscriptionStore();

  const packages = useMemo(() => offering?.availablePackages ?? [], [offering]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // One impression per open: the offering arriving must not re-count it.
  useEffect(() => {
    markPaywallSeen();
    track('paywall_viewed', { source: 'modal' });
  }, [markPaywallSeen]);

  useEffect(() => {
    if (!offering) void loadOffering();
  }, [loadOffering, offering]);

  // Default to the annual plan when there is one — it is the best value and the
  // one most people keep.
  useEffect(() => {
    if (selectedId || packages.length === 0) return;
    const annual = packages.find((pkg) => pkg.packageType === 'ANNUAL');
    setSelectedId((annual ?? packages[0]).identifier);
  }, [packages, selectedId]);

  const selected = packages.find((pkg) => pkg.identifier === selectedId) ?? packages[0] ?? null;

  // Two conditions, both required, because each catches a different way of
  // promising a trial that will not happen:
  //
  //  - the store has to report a free introductory phase on this product, which
  //    rules out a *paid* introductory offer (iOS reports those as "eligible"
  //    too, and quoting free days for them is the same misrepresentation);
  //  - on iOS the offer also has to still be available to this Apple ID, since
  //    Apple grants one per subscription group and `introPrice` is product
  //    metadata that says nothing about who has already used it.
  //
  // Android is left to the product's own free phase: Play filters offers by
  // eligibility before returning them, and `checkTrialEligibility` reports
  // nothing there.
  // Someone who already subscribed is not a prospect: the screen stops selling
  // and says where they stand. Reachable from settings and from the profile.
  const alreadyPro = snapshot?.isSubscribed ?? false;
  const storeTrialDays = selected ? packageTrialDays(selected) : null;
  const eligibleForTrial =
    !alreadyPro &&
    selected !== null &&
    storeTrialDays !== null &&
    // In local mode the eligibility map is the device's own record of whether
    // the introductory offer has been taken, so it is authoritative on every
    // platform — there is no Play-side filtering to defer to.
    ((!USES_LOCAL_BACKEND && Platform.OS !== 'ios') ||
      (trialEligibility[selected.product.identifier] ?? false));
  // Only ever rendered under `eligibleForTrial`, where the store's own number
  // exists; the fallback is there so the type does not need a non-null
  // assertion.
  const trialDays = storeTrialDays ?? TRIAL_DAYS;

  const close = () => router.back();

  const purchase = async () => {
    if (!selected) return;
    if (snapshot?.isSubscribed) {
      Alert.alert(t('paywall.title'), t('paywall.already_pro'));
      return;
    }
    try {
      track('purchase_started', {
        product_id: selected.product.identifier,
        trial: eligibleForTrial,
      });
      const outcome = await buy(selected);
      if (outcome === 'purchased') {
        track('purchase_completed', {
          product_id: selected.product.identifier,
          trial: eligibleForTrial,
        });
        Alert.alert(t('paywall.title'), t('paywall.purchase_done'));
        close();
      }
    } catch (error) {
      // Being offline is worth saying plainly; every other refusal reads the
      // same to the learner, whatever StoreKit called it.
      const code = error instanceof AppError ? error.code : 'unknown';
      Alert.alert(
        t('paywall.title'),
        code === 'network' ? t(errorMessageKey(code)) : t('paywall.purchase_failed')
      );
    }
  };

  const restorePurchases = async () => {
    try {
      const restored = await restore();
      Alert.alert(
        t('paywall.title'),
        restored ? t('paywall.restore_done') : t('paywall.restore_none')
      );
      if (restored) close();
    } catch {
      Alert.alert(t('paywall.title'), t('paywall.unavailable'));
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 6 }}>
      <View className="flex-row items-center justify-between px-5 pb-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('paywall.close')}
          hitSlop={12}
          onPress={close}>
          <Icon as={X} size={26} className="text-muted-foreground" />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => void restorePurchases()}
          disabled={isRestoring}>
          <Text className="font-strong text-sm text-muted-foreground underline">
            {t('paywall.restore')}
          </Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-6 gap-7">
        <View className="items-center gap-3 pt-2">
          <View className="h-16 w-16 items-center justify-center rounded-3xl bg-primary/15">
            <Icon as={Sparkles} size={30} className="text-primary" />
          </View>
          <Text className="text-center font-display text-[30px] leading-9 text-foreground">
            {t('paywall.title')}
          </Text>
          <Text className="text-center text-[15px] leading-6 text-muted-foreground">
            {eligibleForTrial
              ? t('paywall.subtitle_trial', { days: trialDays })
              : t('paywall.subtitle')}
          </Text>
        </View>

        <View className="gap-3">
          {FEATURES.map((feature) => (
            <View key={feature} className="flex-row items-start gap-3">
              <View className="mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-success/20">
                <Icon as={Check} size={14} className="text-success" />
              </View>
              <Text className="flex-1 text-[15px] leading-6 text-foreground">
                {t(`paywall.features.${feature}` as 'paywall.features.ai')}
              </Text>
            </View>
          ))}
        </View>

        {/* Plans */}
        {isLoadingOffering && packages.length === 0 ? (
          <View className="items-center py-8">
            <ActivityIndicator />
          </View>
        ) : packages.length === 0 ? (
          <View className="gap-2 rounded-2xl border-2 border-border bg-card px-4 py-5">
            <Text className="text-center text-[15px] text-muted-foreground">
              {storeAvailable ? t('paywall.unavailable') : t('errors.network')}
            </Text>
          </View>
        ) : (
          <View className="gap-3">
            {packages.map((pkg) => {
              const isSelected = pkg.identifier === selected?.identifier;
              const isAnnual = pkg.packageType === 'ANNUAL';

              return (
                <Pressable
                  key={pkg.identifier}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setSelectedId(pkg.identifier)}
                  className={cn(
                    'flex-row items-center gap-4 rounded-xl border-2 border-input bg-card px-4 py-4',
                    isSelected && 'border-[3px] border-primary bg-primary/10'
                  )}>
                  <View
                    className={cn(
                      'h-6 w-6 items-center justify-center rounded-full border-2 border-border',
                      isSelected && 'border-primary bg-primary'
                    )}>
                    {isSelected ? (
                      <Icon as={Check} size={13} className="text-primary-foreground" />
                    ) : null}
                  </View>

                  <View className="flex-1 gap-0.5">
                    <Text className="font-strong text-[17px] text-foreground">
                      {t(planLabelKey(pkg))}
                    </Text>
                    {/* The billed amount is never smaller or quieter than the
                        trial badge — Apple rejects paywalls where it is. */}
                    <Text className="font-strong text-[15px] text-foreground">
                      {priceLine(pkg, t)}
                    </Text>
                  </View>

                  {isAnnual ? (
                    <View className="rounded-full bg-xp px-2.5 py-1">
                      <Kicker className="text-[11px] tracking-wide text-xp-foreground">
                        {t('paywall.best_value')}
                      </Kicker>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View className="gap-3 px-6 pt-2" style={{ paddingBottom: insets.bottom + 12 }}>
        {alreadyPro ? (
          <Text className="text-center font-mono text-[13px] leading-5 text-accent">
            {t('paywall.already_pro')}
          </Text>
        ) : selected ? (
          <Text className="text-center font-mono text-[13px] leading-5 text-accent">
            {eligibleForTrial
              ? t('paywall.trial_line', { days: trialDays, price: priceLine(selected, t) })
              : t('paywall.no_trial_line', { price: priceLine(selected, t) })}
          </Text>
        ) : null}

        <GameButton
          label={
            alreadyPro
              ? t('common.close')
              : eligibleForTrial
                ? t('paywall.cta_trial', { days: trialDays })
                : t('paywall.cta_buy')
          }
          size="lg"
          busy={isPurchasing}
          disabled={!selected && !alreadyPro}
          onPress={() => (alreadyPro ? close() : void purchase())}
        />

        {/* The billing terms Apple requires are a lie when nothing is billed,
            so the demo build says what it actually does instead. */}
        <Text className="text-center text-[11px] leading-4 text-muted-foreground">
          {USES_LOCAL_BACKEND
            ? eligibleForTrial
              ? t('paywall.local_notice', { days: trialDays })
              : t('paywall.local_notice_no_trial')
            : eligibleForTrial
              ? t('paywall.legal')
              : t('paywall.legal_no_trial')}
        </Text>

        <View className="flex-row items-center justify-center gap-6">
          <Text
            className="font-strong text-xs text-muted-foreground underline"
            onPress={() => void openExternal(LINKS.terms)}>
            {t('paywall.terms')}
          </Text>
          <Text
            className="font-strong text-xs text-muted-foreground underline"
            onPress={() => void openExternal(LINKS.privacy)}>
            {t('paywall.privacy')}
          </Text>
        </View>
      </View>
    </View>
  );
}
