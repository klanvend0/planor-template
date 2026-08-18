/**
 * Theme tokens for JavaScript consumers — the "Cathode" design system.
 *
 * NativeWind classes read the CSS variables in `global.css`; this file mirrors
 * the same values for the places that need a plain color string: the router
 * theme, inline SVG illustrations, Reanimated interpolations and the syntax
 * highlighter. Keep the two in step — same token names, same colors.
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
  surface2: string;
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
  xpForeground: string;
  streak: string;
  streakForeground: string;
  codeBg: string;
  codeBorder: string;
  codeForeground: string;
  codeGutter: string;
  ledgePrimary: string;
  ledgeSuccess: string;
  ledgeDestructive: string;
  ledgeSecondary: string;
  ledgeCard: string;
  border: string;
  input: string;
  ring: string;
  coursePython: string;
  courseJavascript: string;
  radius: string;
};

export const THEME: Record<'light' | 'dark', ThemeTokens> = {
  light: {
    background: 'hsl(180 22% 97%)',
    foreground: 'hsl(200 42% 11%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(200 42% 11%)',
    popover: 'hsl(0 0% 100%)',
    popoverForeground: 'hsl(200 42% 11%)',
    surface2: 'hsl(188 28% 92%)',
    primary: 'hsl(164 92% 26%)',
    primaryForeground: 'hsl(0 0% 100%)',
    secondary: 'hsl(188 30% 90%)',
    secondaryForeground: 'hsl(200 42% 11%)',
    muted: 'hsl(190 20% 92%)',
    mutedForeground: 'hsl(203 16% 38%)',
    accent: 'hsl(196 96% 28%)',
    accentForeground: 'hsl(0 0% 100%)',
    destructive: 'hsl(352 78% 42%)',
    destructiveForeground: 'hsl(0 0% 100%)',
    success: 'hsl(158 90% 26%)',
    successForeground: 'hsl(0 0% 100%)',
    warning: 'hsl(30 92% 34%)',
    warningForeground: 'hsl(0 0% 100%)',
    xp: 'hsl(38 94% 32%)',
    xpForeground: 'hsl(0 0% 100%)',
    streak: 'hsl(16 88% 40%)',
    streakForeground: 'hsl(0 0% 100%)',
    codeBg: 'hsl(192 32% 89%)',
    codeBorder: 'hsl(200 24% 44%)',
    codeForeground: 'hsl(200 32% 13%)',
    codeGutter: 'hsl(200 16% 40%)',
    ledgePrimary: 'hsl(164 94% 14%)',
    ledgeSuccess: 'hsl(158 92% 15%)',
    ledgeDestructive: 'hsl(352 78% 28%)',
    ledgeSecondary: 'hsl(200 20% 72%)',
    ledgeCard: 'hsl(200 18% 78%)',
    border: 'hsl(200 18% 52%)',
    input: 'hsl(200 20% 44%)',
    ring: 'hsl(196 96% 28%)',
    coursePython: 'hsl(206 78% 40%)',
    courseJavascript: 'hsl(40 96% 30%)',
    radius: '1rem',
  },
  dark: {
    background: 'hsl(204 32% 7%)',
    foreground: 'hsl(185 16% 96%)',
    card: 'hsl(204 28% 10%)',
    cardForeground: 'hsl(185 16% 96%)',
    popover: 'hsl(204 30% 12%)',
    popoverForeground: 'hsl(185 16% 96%)',
    surface2: 'hsl(204 26% 14%)',
    primary: 'hsl(158 88% 54%)',
    primaryForeground: 'hsl(204 45% 8%)',
    secondary: 'hsl(204 26% 18%)',
    secondaryForeground: 'hsl(185 16% 96%)',
    muted: 'hsl(204 24% 16%)',
    mutedForeground: 'hsl(197 16% 70%)',
    accent: 'hsl(190 94% 58%)',
    accentForeground: 'hsl(204 45% 8%)',
    destructive: 'hsl(352 92% 64%)',
    destructiveForeground: 'hsl(204 45% 8%)',
    success: 'hsl(152 76% 50%)',
    successForeground: 'hsl(204 45% 8%)',
    warning: 'hsl(38 96% 56%)',
    warningForeground: 'hsl(204 45% 8%)',
    xp: 'hsl(44 96% 58%)',
    xpForeground: 'hsl(204 45% 8%)',
    streak: 'hsl(20 96% 58%)',
    streakForeground: 'hsl(204 45% 8%)',
    codeBg: 'hsl(205 42% 5%)',
    codeBorder: 'hsl(196 32% 38%)',
    codeForeground: 'hsl(196 28% 90%)',
    codeGutter: 'hsl(198 16% 48%)',
    ledgePrimary: 'hsl(158 90% 30%)',
    ledgeSuccess: 'hsl(152 78% 28%)',
    ledgeDestructive: 'hsl(352 80% 38%)',
    ledgeSecondary: 'hsl(204 30% 9%)',
    ledgeCard: 'hsl(204 30% 6%)',
    border: 'hsl(202 20% 43%)',
    input: 'hsl(202 18% 46%)',
    ring: 'hsl(190 94% 58%)',
    coursePython: 'hsl(206 84% 62%)',
    courseJavascript: 'hsl(44 96% 58%)',
    radius: '1rem',
  },
};

/**
 * Syntax highlighting colors.
 *
 * MUST stay keyed by theme: `components/code_block.tsx` reads
 * `SYNTAX[colorScheme][token.type]`, and the light code surface is a paper
 * panel, so one flat palette cannot serve both. All nine `TokenType` values in
 * `lib/syntax.ts` are present — `builtin` and `punctuation` included — plus the
 * six editor affordances the question types need.
 */
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
  /** Line numbers. >=4.4:1 on the code surface — spot-the-bug depends on them. */
  gutter: string;
  /** Block caret in type-the-code and the blank slot. Always the brand color. */
  caret: string;
  /** Text selection well. */
  selection: string;
  /** Background of the focused / suspect line. */
  activeLine: string;
  /** Well behind an empty fill-in-the-blank slot. */
  blankSlot: string;
  /** Wavy underline under an offending token. */
  errorUnderline: string;
};

export const SYNTAX: Record<'light' | 'dark', SyntaxPalette> = {
  light: {
    comment: '#6B6257',
    string: '#3F6B12',
    number: '#7D4B00',
    keyword: '#1B45C4',
    builtin: '#9A1478',
    function: '#4B3FA8',
    operator: '#7A4A2E',
    punctuation: '#4C6673',
    plain: '#17252C',
    gutter: '#566B76',
    caret: '#057F5F',
    selection: '#BFD6DE',
    activeLine: '#CBE2E8',
    blankSlot: '#C6DCE2',
    errorUnderline: '#BF182E',
  },
  dark: {
    comment: '#8397A2',
    string: '#6FD9A4',
    number: '#FFC24D',
    keyword: '#FF7BD5',
    builtin: '#B6E85C',
    function: '#62B4FF',
    operator: '#FFB08A',
    punctuation: '#A9BCC4',
    plain: '#DEE9ED',
    gutter: '#67828E',
    caret: '#22F1A5',
    selection: '#153A3A',
    activeLine: '#0E1D24',
    blankSlot: '#12242C',
    errorUnderline: '#F84F65',
  },
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

/**
 * Resolve the syntax palette for the active scheme.
 *
 * The code surface is a paper panel in light mode and the darkest plane in dark
 * mode, so the two palettes are genuinely different rather than one tinted.
 */
export function syntaxPalette(scheme: 'light' | 'dark' | null | undefined): SyntaxPalette {
  return SYNTAX[scheme ?? 'light'];
}
