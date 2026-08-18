/**
 * Settings.
 *
 * Preferences, subscription management and — required by App Store Review
 * 5.1.1(v) — in-app account deletion, which really deletes rather than
 * deactivates and revokes the Sign in with Apple grant on the way out.
 *
 * @module app/settings
 */

import { router } from 'expo-router';
import * as Application from 'expo-application';
import * as StoreReview from 'expo-store-review';
import { ArrowLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { signOut } from '@/lib/auth';
import { LINKS } from '@/lib/constants';
import { errorMessageKey, toAppError } from '@/lib/errors';
import { openExternal } from '@/lib/links';
import { cn } from '@/lib/utils';
import { deleteAccount } from '@/services/account_service';
import { cancelDailyReminder, requestNotificationPermission, scheduleDailyReminder } from '@/services/notifications_service';
import { updateProfile } from '@/services/progress_service';
import { useAuthStore } from '@/stores/auth_store';
import { useGameStore } from '@/stores/game_store';
import { DAILY_GOALS, useSettingsStore, type ColorSchemePreference } from '@/stores/settings_store';
import { useSubscriptionStore } from '@/stores/subscription_store';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="px-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </Text>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  destructive = false,
  right,
  last = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  right?: React.ReactNode;
  last?: boolean;
}) {
  const content = (
    <View
      className={cn(
        'min-h-[52px] flex-row items-center justify-between gap-3 px-4 py-3',
        !last && 'border-b border-border'
      )}>
      <Text className={cn('flex-1 text-[16px]', destructive ? 'text-destructive' : 'text-foreground')}>
        {label}
      </Text>
      {value ? <Text className="text-[15px] text-muted-foreground">{value}</Text> : null}
      {right ?? (onPress ? <Icon as={ChevronRight} size={18} className="text-muted-foreground" /> : null)}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      {content}
    </Pressable>
  );
}

/** Cycles a value through a fixed list, for the tap-to-change rows. */
function next<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length];
}

export default function SettingsScreen() {
  const { t, locale, setLocale } = useTranslation();
  const insets = useSafeAreaInsets();
  const [deleting, setDeleting] = useState(false);

  const settings = useSettingsStore();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const gameState = useGameStore((state) => state.state);
  const restore = useSubscriptionStore((state) => state.restore);
  const subscriptionSignOut = useSubscriptionStore((state) => state.signOut);

  const isPro = gameState?.hasSubscription ?? false;

  /** Persist a preference locally and, when signed in, to the profile row. */
  const persist = (patch: Parameters<typeof updateProfile>[1]) => {
    if (!userId) return;
    void updateProfile(userId, patch).catch((error) => {
      console.warn('[settings] profile update failed', error);
    });
  };

  const toggleReminders = async (enabled: boolean) => {
    if (!enabled) {
      settings.setReminders(false);
      await cancelDailyReminder();
      persist({ reminderHour: null });
      return;
    }

    const granted = await requestNotificationPermission();
    if (!granted) {
      Alert.alert(t('settings.reminders'), t('settings.reminders_denied'));
      return;
    }
    settings.setReminders(true, settings.reminderHour);
    await scheduleDailyReminder(settings.reminderHour, gameState?.streakDays ?? 0);
    persist({ reminderHour: settings.reminderHour });
  };

  const changeReminderHour = async () => {
    const hour = (settings.reminderHour + 1) % 24;
    settings.setReminders(settings.remindersEnabled, hour);
    if (settings.remindersEnabled) {
      await scheduleDailyReminder(hour, gameState?.streakDays ?? 0);
      persist({ reminderHour: hour });
    }
  };

  const confirmSignOut = () => {
    Alert.alert(t('auth.sign_out_confirm_title'), t('auth.sign_out_confirm_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.sign_out'),
        style: 'destructive',
        onPress: async () => {
          await subscriptionSignOut();
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(t('settings.delete_title'), t('settings.delete_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.delete_confirm'),
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await subscriptionSignOut();
            await deleteAccount();
            settings.reset();
            router.replace('/(onboarding)');
          } catch (error) {
            Alert.alert(t('settings.delete_account'), t(errorMessageKey(toAppError(error).code)));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const restorePurchases = async () => {
    try {
      const restored = await restore();
      Alert.alert(t('settings.restore'), restored ? t('paywall.restore_done') : t('paywall.restore_none'));
    } catch {
      Alert.alert(t('settings.restore'), t('paywall.unavailable'));
    }
  };

  const rateApp = async () => {
    if (await StoreReview.hasAction()) {
      await StoreReview.requestReview();
      return;
    }
    await openExternal(LINKS.support);
  };

  const themeLabel: Record<ColorSchemePreference, string> = {
    system: t('settings.theme_system'),
    light: t('settings.theme_light'),
    dark: t('settings.theme_dark'),
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 px-5 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={12}
          onPress={() => router.back()}>
          <Icon as={ArrowLeft} size={24} className="text-foreground" />
        </Pressable>
        <Text className="font-display text-[22px] text-foreground">{t('settings.title')}</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 gap-6 pb-8"
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <Section title={t('settings.section_learning')}>
          <Row
            label={t('settings.language')}
            value={locale === 'tr' ? 'Türkçe' : 'English'}
            onPress={() => {
              const nextLocale = locale === 'tr' ? 'en' : 'tr';
              void setLocale(nextLocale);
              void settings.setLocale(nextLocale);
              persist({ locale: nextLocale });
            }}
          />
          <Row
            label={t('settings.course')}
            value={settings.activeCourse === 'python' ? 'Python' : 'JavaScript'}
            onPress={() => {
              const course = settings.activeCourse === 'python' ? 'javascript' : 'python';
              settings.setActiveCourse(course);
              persist({ activeCourse: course });
            }}
          />
          <Row
            label={t('settings.daily_goal')}
            value={`${settings.dailyGoalXp} ${t('common.xp')}`}
            last
            onPress={() => {
              const goal = next(DAILY_GOALS, settings.dailyGoalXp);
              settings.setDailyGoal(goal);
              persist({ dailyGoalXp: goal });
            }}
          />
        </Section>

        <Section title={t('settings.section_app')}>
          <Row
            label={t('settings.theme')}
            value={themeLabel[settings.colorScheme]}
            onPress={() =>
              settings.setColorScheme(next(['system', 'light', 'dark'] as const, settings.colorScheme))
            }
          />
          <Row
            label={t('settings.haptics')}
            right={
              <Switch
                value={settings.hapticsEnabled}
                onValueChange={settings.setHapticsEnabled}
                accessibilityLabel={t('settings.haptics')}
              />
            }
          />
          <Row
            label={t('settings.reminders')}
            right={
              <Switch
                value={settings.remindersEnabled}
                onValueChange={(value) => void toggleReminders(value)}
                accessibilityLabel={t('settings.reminders')}
              />
            }
          />
          <Row
            label={t('settings.reminder_time')}
            value={`${String(settings.reminderHour).padStart(2, '0')}:00`}
            last
            onPress={() => void changeReminderHour()}
          />
        </Section>

        <Section title={t('settings.section_account')}>
          <Row
            label={t('settings.subscription')}
            value={isPro ? t('profile.pro_member') : t('profile.free_member')}
            onPress={() => (isPro ? void openExternal(LINKS.manageSubscription) : router.push('/paywall'))}
          />
          <Row label={t('settings.restore')} onPress={() => void restorePurchases()} />
          <Row label={t('settings.sign_out')} onPress={confirmSignOut} />
          <Row
            label={deleting ? t('common.loading') : t('settings.delete_account')}
            destructive
            last
            onPress={deleting ? undefined : confirmDelete}
          />
        </Section>

        <Section title={t('settings.section_about')}>
          <Row label={t('settings.terms')} onPress={() => void openExternal(LINKS.terms)} />
          <Row label={t('settings.privacy')} onPress={() => void openExternal(LINKS.privacy)} />
          <Row label={t('settings.support')} onPress={() => void openExternal(LINKS.support)} />
          <Row label={t('settings.rate_app')} onPress={() => void rateApp()} />
          <Row
            label={t('settings.version', {
              version: `${Application.nativeApplicationVersion ?? '1.0.0'} (${
                Application.nativeBuildVersion ?? '1'
              })`,
            })}
            last
          />
        </Section>
      </ScrollView>
    </View>
  );
}
