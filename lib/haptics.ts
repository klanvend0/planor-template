/**
 * Haptic feedback.
 *
 * Every tap in a game needs an answer from the device. These helpers respect the
 * learner's haptics setting and are safe on platforms without a taptic engine —
 * the promise resolves, nothing happens.
 *
 * @module lib/haptics
 */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { settingsSnapshot } from '@/stores/settings_store';

function enabled(): boolean {
  return settingsSnapshot().hapticsEnabled && Platform.OS !== 'web';
}

/** Light tick for selecting an option or a token. */
export async function tapFeedback(): Promise<void> {
  if (!enabled()) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // Device without haptics; silence is the fallback.
  }
}

/** Firmer tap for primary buttons. */
export async function pressFeedback(): Promise<void> {
  if (!enabled()) return;
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {
    /* no-op */
  }
}

/** Success chime for a correct answer. */
export async function correctFeedback(): Promise<void> {
  if (!enabled()) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    /* no-op */
  }
}

/** Error buzz for a wrong answer. */
export async function incorrectFeedback(): Promise<void> {
  if (!enabled()) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    /* no-op */
  }
}

/** Celebration for finishing a lesson or unlocking an achievement. */
export async function celebrateFeedback(): Promise<void> {
  if (!enabled()) return;
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    /* no-op */
  }
}
