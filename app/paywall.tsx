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
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { LINKS, TRIAL_DAYS } from '@/lib/constants';
import { errorMessageKey } from '@/lib/errors';
import { openExternal } from '@/lib/links';
import { packageTrialDays } from '@/services/purchases_service';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings_store';
import { useSubscriptionStore } from '@/stores/subscription_store';

const FEATURES = ['ai', 'hearts', 'courses', 'practice', 'support'] as const;

/** Human label for a package, from the store's own period type. */
function planLabelKey(
  pkg: PurchasesPackage
): 'paywall.plan_weekly' | 'paywall.plan_monthly' | 'paywall.plan_annual' {
  switch (pkg.packageType) {
    case 'WEEKLY':
      return 'paywall.plan_weekly';
    case 'ANNUAL':
      return 'paywall.plan_annual';
    default:
      return 'paywall.plan_monthly';
  }
}

/** Price line for a package, in the period the store sells it in. */
function priceKey(
  pkg: PurchasesPackage
): 'paywall.per_week' | 'paywall.per_month' | 'paywall.per_year' {
  switch (pkg.packageType) {
    case 'WEEKLY':
      return 'paywall.per_week';
    case 'ANNUAL':
      return 'paywall.per_year';
    default:
      return 'paywall.per_month';
  }
}

export default function PaywallScreen() {
  const { t } = useTranslation();
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

  useEffect(() => {
    markPaywallSeen();
    if (!offering) void loadOffering();
  }, [loadOffering, markPaywallSeen, offering]);

  // Default to the annual plan when there is one — it is the best value and the
  // one most people keep.
  useEffect(() => {
    if (selectedId || packages.length === 0) return;
    const annual = packages.find((pkg) => pkg.packageType === 'ANNUAL');
    setSelectedId((annual ?? packages[0]).identifier);
  }, [packages, selectedId]);

  const selected = packages.find((pkg) => pkg.identifier === selectedId) ?? packages[0] ?? null;
  const eligibleForTrial = selected
    ? (trialEligibility[selected.product.identifier] ?? false) ||
      packageTrialDays(selected) !== null
    : false;
  const trialDays = selected ? (packageTrialDays(selected) ?? TRIAL_DAYS) : TRIAL_DAYS;

  const close = () => router.back();

  const purchase = async () => {
    if (!selected) return;
    try {
      const outcome = await buy(selected);
      if (outcome === 'purchased') {
        Alert.alert(t('paywall.title'), t('paywall.restore_done'));
        close();
      }
    } catch (error) {
      const code = (error as { code?: never })?.code;
      Alert.alert(t('paywall.title'), t(errorMessageKey(code ?? 'store_unavailable')));
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
          <Text className="font-semibold text-sm text-muted-foreground underline">
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
            {t('paywall.subtitle')}
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
                    'flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card px-4 py-4',
                    isSelected && 'border-primary bg-primary/10'
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
                    <Text className="font-bold text-[17px] text-foreground">
                      {t(planLabelKey(pkg))}
                    </Text>
                    {/* The billed amount is never smaller or quieter than the
                        trial badge — Apple rejects paywalls where it is. */}
                    <Text className="font-semibold text-[15px] text-foreground">
                      {t(priceKey(pkg), { price: pkg.product.priceString })}
                    </Text>
                  </View>

                  {isAnnual ? (
                    <View className="rounded-full bg-success/20 px-2.5 py-1">
                      <Text className="font-bold text-[11px] uppercase tracking-wide text-success">
                        {t('paywall.best_value')}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View className="gap-3 px-6 pt-2" style={{ paddingBottom: insets.bottom + 12 }}>
        {selected ? (
          <Text className="text-center text-[13px] leading-5 text-muted-foreground">
            {eligibleForTrial
              ? t('paywall.trial_line', {
                  days: trialDays,
                  price: t(priceKey(selected), { price: selected.product.priceString }),
                })
              : t('paywall.no_trial_line', {
                  price: t(priceKey(selected), { price: selected.product.priceString }),
                })}
          </Text>
        ) : null}

        <GameButton
          label={
            eligibleForTrial ? t('paywall.cta_trial', { days: trialDays }) : t('paywall.cta_buy')
          }
          size="lg"
          busy={isPurchasing}
          disabled={!selected || snapshot?.isSubscribed}
          onPress={() => void purchase()}
        />

        <Text className="text-center text-[11px] leading-4 text-muted-foreground">
          {t('paywall.legal')}
        </Text>

        <View className="flex-row items-center justify-center gap-6">
          <Text
            className="font-semibold text-xs text-muted-foreground underline"
            onPress={() => void openExternal(LINKS.terms)}>
            {t('paywall.terms')}
          </Text>
          <Text
            className="font-semibold text-xs text-muted-foreground underline"
            onPress={() => void openExternal(LINKS.privacy)}>
            {t('paywall.privacy')}
          </Text>
        </View>
      </View>
    </View>
  );
}
