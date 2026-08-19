/**
 * Daily reminder notifications.
 *
 * One local notification a day at the hour the learner picked — no push server,
 * no tokens, nothing to leak. Scheduling is idempotent: every call cancels the
 * previous reminder before adding the new one.
 *
 * @module services/notifications_service
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { t } from '@/lib/i18n';

const REMINDER_IDENTIFIER = 'codeling.daily-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Ask for notification permission.
 *
 * @returns True when reminders may be scheduled. Never throws: a learner who
 * declines simply keeps the app without reminders.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch (error) {
    console.warn('[notifications] permission request failed', error);
    return false;
  }
}

/** True when the OS currently allows notifications. */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const status = await Notifications.getPermissionsAsync();
    return status.granted;
  } catch {
    return false;
  }
}

/**
 * (Re)schedule the daily reminder.
 *
 * @param hour - Local hour, 0-23.
 * @param streakDays - Current streak, so the copy can reference it.
 * @returns Whether a reminder is now scheduled. False means the OS refused,
 * which the settings screen has to show rather than leaving a switch on that
 * does nothing.
 */
export async function scheduleDailyReminder(hour: number, streakDays: number): Promise<boolean> {
  await cancelDailyReminder();

  const granted = await hasNotificationPermission();
  if (!granted) return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      // The channel name is what Android shows in its own settings list, so it
      // has to be in the learner's language like everything else.
      name: t('settings.reminders'),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_IDENTIFIER,
    content: {
      title: t('notifications.reminder_title'),
      body:
        streakDays > 0
          ? t('notifications.reminder_body', { count: streakDays })
          : t('notifications.reminder_body_zero'),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Math.max(0, Math.min(23, Math.round(hour))),
      minute: 0,
      channelId: Platform.OS === 'android' ? 'reminders' : undefined,
    },
  });

  return true;
}

/** Remove the scheduled reminder, e.g. when the learner turns them off. */
export async function cancelDailyReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_IDENTIFIER);
  } catch {
    // Nothing scheduled under that identifier; that is the desired end state.
  }
}
