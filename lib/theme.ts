/**
 * Theme tokens for JavaScript consumers.
 *
 * NativeWind classes read the CSS variables in `global.css`; this file mirrors
 * the same values for the places that need a plain color string — the router's
 * theme, SVG illustrations, status bar, and Reanimated interpolations.
 *
 * Keep it in step with `global.css`: same token names, same colors.
 *
 * Note: since Expo SDK 56 expo-router no longer depends on React Navigation, so
 * the theme types come from `expo-router` itself.
 *
 * @module lib/theme
 */

import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

export type ThemeTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  xp: string;
  streak: string;
  codeBg: string;
  codeBorder: string;
  codeForeground: string;
  surface2: string;
  border: string;
  input: string;
  ring: string;
  coursePython: string;
  courseJavascript: string;
  radius: string;
};

/** Syntax highlighting colors, keyed by the token types in `lib/syntax.ts`. */
export type SyntaxPalette = {
  comment: string;
  string: string;
  number: string;
  keyword: string;
  builtin: string;
  function: string;
  operator: string;
  punctuation: string;
  plain: string;
};

export const THEME: Record<'light' | 'dark', ThemeTokens> = {
  light: {
    background: 'hsl(30 24% 97%)',
    foreground: 'hsl(230 26% 12%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(230 26% 12%)',
    popover: 'hsl(0 0% 100%)',
    popoverForeground: 'hsl(230 26% 12%)',
    primary: 'hsl(255 74% 58%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(255 42% 95%)',
    secondaryForeground: 'hsl(255 45% 32%)',
    muted: 'hsl(30 16% 93%)',
    mutedForeground: 'hsl(230 12% 42%)',
    accent: 'hsl(190 90% 42%)',
    accentForeground: 'hsl(0 0% 100%)',
    destructive: 'hsl(2 76% 52%)',
    destructiveForeground: 'hsl(0 0% 100%)',
    success: 'hsl(152 62% 36%)',
    successForeground: 'hsl(0 0% 100%)',
    warning: 'hsl(38 92% 48%)',
    warningForeground: 'hsl(30 40% 10%)',
    xp: 'hsl(255 74% 58%)',
    streak: 'hsl(24 92% 52%)',
    codeBg: 'hsl(230 28% 14%)',
    codeBorder: 'hsl(230 22% 24%)',
    codeForeground: 'hsl(220 22% 92%)',
    surface2: 'hsl(30 20% 94%)',
    border: 'hsl(30 14% 87%)',
    input: 'hsl(30 14% 87%)',
    ring: 'hsl(255 74% 58%)',
    coursePython: 'hsl(205 78% 46%)',
    courseJavascript: 'hsl(45 92% 45%)',
    radius: '1rem',
  },
  dark: {
    background: 'hsl(230 28% 9%)',
    foreground: 'hsl(220 22% 94%)',
    card: 'hsl(230 25% 13%)',
    cardForeground: 'hsl(220 22% 94%)',
    popover: 'hsl(230 25% 13%)',
    popoverForeground: 'hsl(220 22% 94%)',
    primary: 'hsl(255 88% 72%)',
    primaryForeground: 'hsl(230 30% 10%)',
    secondary: 'hsl(230 22% 19%)',
    secondaryForeground: 'hsl(220 22% 94%)',
    muted: 'hsl(230 20% 18%)',
    mutedForeground: 'hsl(225 14% 68%)',
    accent: 'hsl(188 92% 56%)',
    accentForeground: 'hsl(230 30% 10%)',
    destructive: 'hsl(2 84% 66%)',
    destructiveForeground: 'hsl(230 30% 10%)',
    success: 'hsl(152 66% 52%)',
    successForeground: 'hsl(230 30% 10%)',
    warning: 'hsl(38 96% 60%)',
    warningForeground: 'hsl(230 30% 10%)',
    xp: 'hsl(255 88% 72%)',
    streak: 'hsl(24 96% 60%)',
    codeBg: 'hsl(230 30% 12%)',
    codeBorder: 'hsl(230 20% 22%)',
    codeForeground: 'hsl(220 22% 92%)',
    surface2: 'hsl(230 24% 16%)',
    border: 'hsl(230 18% 22%)',
    input: 'hsl(230 18% 22%)',
    ring: 'hsl(255 88% 72%)',
    coursePython: 'hsl(205 84% 62%)',
    courseJavascript: 'hsl(45 96% 60%)',
    radius: '1rem',
  },
};

/**
 * Code colors.
 *
 * The code surface is dark in both themes — a snippet should look like an editor
 * wherever it appears — so one palette serves both, tuned against `codeBg`.
 */
export const SYNTAX: SyntaxPalette = {
  comment: '#7C86A3',
  string: '#7DD3A0',
  number: '#F0B072',
  keyword: '#A78BFA',
  builtin: '#5FD3E8',
  function: '#7FB8FF',
  operator: '#E3E8F5',
  punctuation: '#AAB2C8',
  plain: '#E3E8F5',
};

/** Router theme, so native screen transitions match the app background. */
export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};

/** Resolve tokens for the active scheme; defaults to light. */
export function themeTokens(scheme: 'light' | 'dark' | null | undefined): ThemeTokens {
  return THEME[scheme ?? 'light'];
}
