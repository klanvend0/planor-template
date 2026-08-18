/**
 * Motion constants.
 *
 * One place for the curves and springs so every animation in the app moves like
 * the same object. The rule the design system sets: animate transform and
 * opacity only — the single exception is the XP bar's width, which is
 * information rather than decoration.
 *
 * @module lib/motion
 */

import { Easing } from 'react-native-reanimated';

/** Everyday movement: state changes, presses, cross-fades. */
export const STANDARD = Easing.bezier(0.2, 0, 0, 1);

/** Things arriving: sheets, screens, celebrations. Decelerates hard. */
export const ENTER = Easing.bezier(0.16, 1, 0.3, 1);

/** Things leaving. Accelerates away. */
export const EXIT = Easing.bezier(0.3, 0, 1, 1);

/** Meters and bars filling. */
export const METER = Easing.bezier(0.22, 1, 0.36, 1);

/** Release of a pressed control — quick, barely any overshoot. */
export const PRESS_SPRING = { damping: 18, stiffness: 320, mass: 0.7 } as const;

/** A reward appearing: a little overshoot is the point. */
export const POP_SPRING = { damping: 15, stiffness: 260, mass: 0.8 } as const;

/** Sheets rising from the bottom edge. */
export const SHEET_SPRING = { damping: 20, stiffness: 200 } as const;

/** Durations, in milliseconds. */
export const DURATION = {
  /** Press-in, before the spring takes the release. */
  press: 90,
  /** Cross-fade between two states of the same element. */
  stateChange: 200,
  /** A sheet or panel rising. */
  sheet: 240,
  /** A screen's content settling in. */
  screen: 260,
  /** Between staggered children. */
  stagger: 40,
  /** The wrong-answer shake, per step (five steps). */
  shakeStep: 48,
} as const;

/** The editor caret's hard blink: on for 530ms, off for 470ms, never a fade. */
export const CARET = { on: 530, off: 470 } as const;
