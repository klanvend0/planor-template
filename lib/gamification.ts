/**
 * Gamification rules.
 *
 * Pure functions only — no Supabase, no React — so the level curve, league
 * thresholds and achievement conditions can be unit tested and reused by both
 * the UI and (if it ever moves server-side) the backend.
 *
 * @module lib/gamification
 */

import { PASS_SCORE } from '@/lib/constants';
import type { TranslationKeys } from '@/lib/i18n';

/** XP needed to go from `level` to `level + 1`. Grows linearly, not brutally. */
export function xpForNextLevel(level: number): number {
  return 100 + Math.max(0, level - 1) * 50;
}

/** Total XP needed to reach `level` from zero. */
export function xpToReachLevel(level: number): number {
  let total = 0;
  for (let current = 1; current < level; current += 1) {
    total += xpForNextLevel(current);
  }
  return total;
}

export type LevelInfo = {
  /** 1-based level. */
  level: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP the current level costs in total. */
  xpForLevel: number;
  /** 0..1 progress through the current level. */
  progress: number;
  /** XP still missing to level up. */
  xpRemaining: number;
};

/** Resolve a total XP number into level + progress within that level. */
export function levelFromXp(totalXp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  let consumed = 0;

  while (consumed + xpForNextLevel(level) <= safeXp) {
    consumed += xpForNextLevel(level);
    level += 1;
  }

  const xpForLevel = xpForNextLevel(level);
  const xpIntoLevel = safeXp - consumed;

  return {
    level,
    xpIntoLevel,
    xpForLevel,
    progress: xpForLevel === 0 ? 0 : xpIntoLevel / xpForLevel,
    xpRemaining: xpForLevel - xpIntoLevel,
  };
}

export const LEAGUES = ['bronze', 'silver', 'gold', 'sapphire', 'ruby', 'diamond'] as const;

export type League = (typeof LEAGUES)[number];

/** Weekly XP at which each league starts. */
export const LEAGUE_THRESHOLDS: Record<League, number> = {
  bronze: 0,
  silver: 150,
  gold: 400,
  sapphire: 800,
  ruby: 1500,
  diamond: 2500,
};

export type LeagueInfo = {
  league: League;
  next: League | null;
  /** Weekly XP still needed for the next league, or 0 at the top. */
  xpToNext: number;
  /** 0..1 progress towards the next league. */
  progress: number;
};

/** Which league a given amount of XP earned in the last 7 days lands in. */
export function leagueFromWeeklyXp(weeklyXp: number): LeagueInfo {
  const safeXp = Math.max(0, Math.floor(weeklyXp));
  let index = 0;
  for (let i = LEAGUES.length - 1; i >= 0; i -= 1) {
    if (safeXp >= LEAGUE_THRESHOLDS[LEAGUES[i]]) {
      index = i;
      break;
    }
  }

  const league = LEAGUES[index];
  const next = index < LEAGUES.length - 1 ? LEAGUES[index + 1] : null;
  if (!next) return { league, next: null, xpToNext: 0, progress: 1 };

  const floorXp = LEAGUE_THRESHOLDS[league];
  const ceilingXp = LEAGUE_THRESHOLDS[next];
  return {
    league,
    next,
    xpToNext: ceilingXp - safeXp,
    progress: (safeXp - floorXp) / (ceilingXp - floorXp),
  };
}

/** Everything an achievement can be unlocked by. */
export type AchievementStats = {
  totalXp: number;
  streakDays: number;
  longestStreak: number;
  lessonsCompleted: number;
  perfectLessons: number;
  aiReviewsPassed: number;
  coursesStarted: number;
  unitsCompleted: number;
};

export type AchievementId =
  | 'first_lesson'
  | 'streak_3'
  | 'streak_7'
  | 'streak_30'
  | 'xp_100'
  | 'xp_1000'
  | 'perfect_5'
  | 'unit_complete'
  | 'explainer'
  | 'polyglot';

export type Achievement = {
  id: AchievementId;
  titleKey: TranslationKeys;
  bodyKey: TranslationKeys;
  /** Lucide icon name resolved by the achievement grid. */
  icon: string;
  /** How far along the learner is, 0..1. */
  progress: (stats: AchievementStats) => number;
};

const ratio = (value: number, target: number): number =>
  target <= 0 ? 1 : Math.min(1, Math.max(0, value / target));

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_lesson',
    titleKey: 'achievements.first_lesson.title',
    bodyKey: 'achievements.first_lesson.body',
    icon: 'Footprints',
    progress: (s) => ratio(s.lessonsCompleted, 1),
  },
  {
    id: 'streak_3',
    titleKey: 'achievements.streak_3.title',
    bodyKey: 'achievements.streak_3.body',
    icon: 'Flame',
    progress: (s) => ratio(s.longestStreak, 3),
  },
  {
    id: 'streak_7',
    titleKey: 'achievements.streak_7.title',
    bodyKey: 'achievements.streak_7.body',
    icon: 'CalendarCheck',
    progress: (s) => ratio(s.longestStreak, 7),
  },
  {
    id: 'streak_30',
    titleKey: 'achievements.streak_30.title',
    bodyKey: 'achievements.streak_30.body',
    icon: 'Shield',
    progress: (s) => ratio(s.longestStreak, 30),
  },
  {
    id: 'xp_100',
    titleKey: 'achievements.xp_100.title',
    bodyKey: 'achievements.xp_100.body',
    icon: 'Zap',
    progress: (s) => ratio(s.totalXp, 100),
  },
  {
    id: 'xp_1000',
    titleKey: 'achievements.xp_1000.title',
    bodyKey: 'achievements.xp_1000.body',
    icon: 'Trophy',
    progress: (s) => ratio(s.totalXp, 1000),
  },
  {
    id: 'perfect_5',
    titleKey: 'achievements.perfect_5.title',
    bodyKey: 'achievements.perfect_5.body',
    icon: 'Target',
    progress: (s) => ratio(s.perfectLessons, 5),
  },
  {
    id: 'unit_complete',
    titleKey: 'achievements.unit_complete.title',
    bodyKey: 'achievements.unit_complete.body',
    icon: 'Flag',
    progress: (s) => ratio(s.unitsCompleted, 1),
  },
  {
    id: 'explainer',
    titleKey: 'achievements.explainer.title',
    bodyKey: 'achievements.explainer.body',
    icon: 'MessageSquareCode',
    progress: (s) => ratio(s.aiReviewsPassed, 1),
  },
  {
    id: 'polyglot',
    titleKey: 'achievements.polyglot.title',
    bodyKey: 'achievements.polyglot.body',
    icon: 'Languages',
    progress: (s) => ratio(s.coursesStarted, 2),
  },
];

/** An achievement counts as unlocked once its progress reaches 1. */
export function isUnlocked(achievement: Achievement, stats: AchievementStats): boolean {
  return achievement.progress(stats) >= 1;
}

/** Stars for a lesson score, mirroring `complete_lesson` in Postgres. */
export function starsForScore(score: number): 0 | 1 | 2 | 3 {
  if (score >= 100) return 3;
  if (score >= 80) return 2;
  if (score >= PASS_SCORE) return 1;
  return 0;
}

/** Hearts regenerate one per 30 minutes, capped at five. */
export const HEART_REGEN_MINUTES = 30;
export const MAX_HEARTS = 5;

/**
 * Milliseconds until the next heart arrives.
 *
 * @param hearts - Hearts currently held.
 * @param heartsUpdatedAt - Timestamp the balance last changed.
 * @param now - Injectable clock, for tests.
 * @returns Milliseconds to wait, or 0 when hearts are already full.
 */
export function msUntilNextHeart(
  hearts: number,
  heartsUpdatedAt: string | Date,
  now: Date = new Date()
): number {
  if (hearts >= MAX_HEARTS) return 0;
  const since = typeof heartsUpdatedAt === 'string' ? new Date(heartsUpdatedAt) : heartsUpdatedAt;
  const elapsed = now.getTime() - since.getTime();
  const period = HEART_REGEN_MINUTES * 60 * 1000;
  const remainder = elapsed % period;
  return Math.max(0, period - remainder);
}

/** Format a millisecond countdown as `m:ss`, for the hearts sheet. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
