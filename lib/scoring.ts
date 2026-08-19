/**
 * The rules the server scores by.
 *
 * `complete_lesson`, `record_answer`, `record_practice`, `refill_hearts` and
 * `settle_hearts` in `supabase/migrations/20260818120000_init_codeling.sql` are
 * the authority on what a run pays and what it costs. Two other places have to
 * agree with them: the optimistic estimate shown when a lesson is finished
 * offline, and the local backend that runs the whole game when the app has no
 * Supabase credentials. Both call into here, so there is one implementation to
 * keep in step with the SQL rather than three.
 *
 * Every function is pure and takes `now` explicitly, so the rules can be tested
 * without waiting for a clock.
 *
 * @module lib/scoring
 */

import { MAX_HEARTS, HEART_REGEN_MINUTES } from '@/lib/gamification';

/** Paid once, the first time a lesson is cleared without a mistake. */
export const PERFECT_BONUS_XP = 10;
/** Paid when the streak reaches a multiple of {@link STREAK_BONUS_EVERY}. */
export const STREAK_BONUS_XP = 25;
export const STREAK_BONUS_EVERY = 7;
/** Banked with the streak bonus, spent to survive one missed day. */
export const MAX_STREAK_FREEZES = 2;
export const PRACTICE_XP_PER_CORRECT = 5;
/** Practice is a warm-up, not a farm: it stops paying after this each day. */
export const PRACTICE_DAILY_XP_CAP = 50;
/** How long a free learner waits between heart refills. */
export const FREE_REFILL_HOURS = 24;
/** How far back an offline claim may date a lesson. */
export const MAX_BACKDATED_DAYS = 2;

const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` date in UTC. */
export type IsoDate = string;

export function toIsoDate(at: Date | number): IsoDate {
  return new Date(at).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The lesson score, as a percentage of the questions that were asked. */
export function scoreFor(correct: number, questions: number): number {
  const total = Math.max(1, questions);
  return Math.round((Math.min(Math.max(0, correct), total) / total) * 100);
}

/**
 * A lesson played offline may be dated to the learner's own day, but only
 * within the window the server accepts — otherwise a device clock could invent
 * a streak.
 */
export function clampPlayedOn(playedOn: IsoDate | null | undefined, today: IsoDate): IsoDate {
  if (!playedOn) return today;
  const diff = daysBetween(playedOn, today);
  if (diff < 0) return today;
  return diff > MAX_BACKDATED_DAYS
    ? toIsoDate(Date.parse(`${today}T00:00:00Z`) - MAX_BACKDATED_DAYS * DAY_MS)
    : playedOn;
}

/**
 * What a run pays.
 *
 * XP is paid for improvement only: replaying a lesson at the same score pays
 * nothing, and deliberately scoring badly to farm the difference pays nothing
 * either, because the award is measured against the learner's best.
 */
export function lessonAward(params: { score: number; bestBefore: number; baseXp: number }): {
  award: number;
  perfectBonus: number;
} {
  const { score, bestBefore, baseXp } = params;
  return {
    award: score > bestBefore ? awardFor(baseXp, score - bestBefore) : 0,
    perfectBonus: score === 100 && bestBefore < 100 ? PERFECT_BONUS_XP : 0,
  };
}

/**
 * `round(baseXp * (delta / 100))`, done the way Postgres does it.
 *
 * The SQL divides by the numeric literal `100.0`, so the whole expression is
 * exact decimal and `round()` breaks ties away from zero. In doubles the same
 * expression lands just under the boundary — 150 * (57/100) is 85.49999999999999
 * — and pays one XP less than the server on thirteen reachable pairs. Both
 * operands here are integers, so the remainder decides the tie exactly.
 */
function awardFor(baseXp: number, delta: number): number {
  const scaled = baseXp * delta;
  const whole = Math.floor(scaled / 100);
  return scaled - whole * 100 >= 50 ? whole + 1 : whole;
}

export type StreakInput = {
  /** The last day the learner finished something, or null for a first lesson. */
  lastActiveDate: IsoDate | null;
  /** The day this lesson was played, already clamped. */
  playedOn: IsoDate;
  streakDays: number;
  streakFreezes: number;
};

export type StreakOutcome = {
  streakDays: number;
  streakFreezes: number;
  /** XP paid for reaching a seven-day mark, 0 otherwise. */
  bonus: number;
};

/**
 * Where the streak stands after a lesson.
 *
 * A single missed day is survivable if the learner has banked a freeze, which
 * is what the seven-day bonus pays out alongside the XP.
 */
export function streakAfter(input: StreakInput): StreakOutcome {
  const { lastActiveDate, playedOn } = input;
  let streakDays = input.streakDays;
  let streakFreezes = input.streakFreezes;

  if (lastActiveDate === null) {
    streakDays = 1;
  } else {
    const gap = daysBetween(lastActiveDate, playedOn);
    if (gap <= 0) {
      // Already counted today; a second lesson does not extend anything.
    } else if (gap === 1) {
      streakDays += 1;
    } else if (gap === 2 && streakFreezes > 0) {
      streakDays += 1;
      streakFreezes -= 1;
    } else {
      streakDays = 1;
    }
  }

  // Only the first lesson of a day can reach a mark, so the bonus cannot be
  // collected twice by playing again.
  const reachedMark =
    lastActiveDate !== playedOn && streakDays > 0 && streakDays % STREAK_BONUS_EVERY === 0;

  return {
    streakDays,
    streakFreezes: reachedMark ? Math.min(MAX_STREAK_FREEZES, streakFreezes + 1) : streakFreezes,
    bonus: reachedMark ? STREAK_BONUS_XP : 0,
  };
}

export type HeartsState = {
  hearts: number;
  /** ISO timestamp the balance was last changed. */
  heartsUpdatedAt: string;
};

/**
 * Hearts regenerate one per half hour rather than on a timer: the balance is
 * settled from the clock whenever it is read or spent.
 */
export function settleHearts(state: HeartsState, now: number): HeartsState {
  if (state.hearts >= MAX_HEARTS) {
    return { hearts: MAX_HEARTS, heartsUpdatedAt: new Date(now).toISOString() };
  }

  const since = Date.parse(state.heartsUpdatedAt);
  if (!Number.isFinite(since))
    return { hearts: state.hearts, heartsUpdatedAt: state.heartsUpdatedAt };

  const regenerated = Math.floor((now - since) / (HEART_REGEN_MINUTES * 60_000));
  if (regenerated <= 0) return state;

  const hearts = Math.min(MAX_HEARTS, state.hearts + regenerated);
  return {
    hearts,
    // Anything short of full keeps the remainder of the current half hour, so
    // regeneration is not restarted by looking at it.
    heartsUpdatedAt:
      hearts >= MAX_HEARTS
        ? new Date(now).toISOString()
        : new Date(since + regenerated * HEART_REGEN_MINUTES * 60_000).toISOString(),
  };
}

/**
 * What a wrong answer costs.
 *
 * Practice never spends a heart — it is a warm-up over questions already met,
 * so it cannot put the lesson path out of reach — and neither does a
 * subscription.
 */
export function heartsAfterAnswer(
  state: HeartsState,
  params: { isCorrect: boolean; unlimited: boolean; isPractice: boolean },
  now: number
): HeartsState {
  const settled = settleHearts(state, now);
  if (params.isCorrect || params.unlimited || params.isPractice) return settled;

  return {
    hearts: Math.max(0, settled.hearts - 1),
    // A full balance starts its regeneration clock the moment it is broken.
    heartsUpdatedAt:
      settled.hearts >= MAX_HEARTS ? new Date(now).toISOString() : settled.heartsUpdatedAt,
  };
}

/** True when a free learner may take another refill. */
export function canRefillHearts(
  lastFreeRefillAt: string | null,
  unlimited: boolean,
  now: number
): boolean {
  if (unlimited || !lastFreeRefillAt) return true;
  const since = Date.parse(lastFreeRefillAt);
  return !Number.isFinite(since) || now - since >= FREE_REFILL_HOURS * 3_600_000;
}

/** What a practice run pays, given what practice has already paid today. */
export function practiceAward(correct: number, earnedToday: number): number {
  return Math.max(
    0,
    Math.min(correct * PRACTICE_XP_PER_CORRECT, PRACTICE_DAILY_XP_CAP - earnedToday)
  );
}
