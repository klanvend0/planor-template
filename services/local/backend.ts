/**
 * The device as the backend.
 *
 * Every RPC and table read in {@link services/progress_service} has a twin
 * here, with the same signature and the same rules — {@link lib/scoring} is
 * shared with the SQL, and the lesson catalog the server keeps in Postgres is
 * the bundled question bank, which is already the authority on what a lesson
 * costs and pays.
 *
 * What is deliberately *not* faithful: there is no other device to conflict
 * with, so nothing here worries about concurrency beyond serializing writes,
 * and there is no anti-cheat, because the learner is the only party and their
 * own storage is theirs to edit.
 *
 * @module services/local/backend
 */

import { XP_BY_DIFFICULTY, type CourseId } from '@/lib/content_schema';
import { MAX_HEARTS, starsForScore } from '@/lib/gamification';
import type { SupportedLocale } from '@/lib/i18n';
import { PASS_SCORE } from '@/lib/constants';
import {
  canRefillHearts,
  clampPlayedOn,
  heartsAfterAnswer,
  lessonAward,
  practiceAward,
  scoreFor,
  settleHearts,
  streakAfter,
  toIsoDate,
} from '@/lib/scoring';
import { getLesson, getLessonBaseXp } from '@/services/content_service';
import type { ExplanationVerdict } from '@/services/grading_service';
import type {
  AnswerOutcome,
  GameState,
  LessonProgress,
  LessonResult,
  Profile,
} from '@/services/progress_service';

import {
  mutateDocument,
  readDocument,
  resetDocument,
  type LocalDocument,
  type LocalGameState,
} from './document';

const LOCAL_USER_ID = 'local-learner';

/** True while a locally purchased subscription is still inside its period. */
function isSubscribed(document: LocalDocument, now: number): boolean {
  const subscription = document.subscription;
  return !!subscription && Date.parse(subscription.expiresAt) > now;
}

function xpOn(document: LocalDocument, day: string): number {
  return document.xpEvents
    .filter((event) => event.earnedOn === day)
    .reduce((sum, event) => sum + event.amount, 0);
}

function xpSince(document: LocalDocument, day: string): number {
  return document.xpEvents
    .filter((event) => event.earnedOn > day)
    .reduce((sum, event) => sum + event.amount, 0);
}

function dayBefore(day: string, days: number): string {
  return toIsoDate(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000);
}

function toGameState(document: LocalDocument, now: number): GameState {
  const today = toIsoDate(now);
  const game = document.game;

  return {
    totalXp: game.totalXp,
    hearts: game.hearts,
    heartsUpdatedAt: game.heartsUpdatedAt,
    streakDays: game.streakDays,
    longestStreak: game.longestStreak,
    lastActiveDate: game.lastActiveDate,
    streakFreezes: game.streakFreezes,
    lessonsCompleted: game.lessonsCompleted,
    perfectLessons: game.perfectLessons,
    dailyXp: xpOn(document, today),
    // The server sums `earned_on > today - 7`, which is today plus six days.
    weeklyXp: xpSince(document, dayBefore(today, 7)),
    hasSubscription: isSubscribed(document, now),
  };
}

function applyHearts(game: LocalGameState, settled: { hearts: number; heartsUpdatedAt: string }) {
  game.hearts = settled.hearts;
  game.heartsUpdatedAt = settled.heartsUpdatedAt;
}

/** The signed-in learner, or null before they have started. */
export async function currentUser(): Promise<{ id: string; createdAt: string } | null> {
  return (await readDocument()).user;
}

/**
 * Start playing.
 *
 * There is nobody to authenticate against, so this only marks the point the
 * device started keeping progress — which is what the profile screen shows as
 * "learning since".
 */
export async function signIn(): Promise<{ id: string; createdAt: string }> {
  const { result } = await mutateDocument((document) => {
    document.startedAt ??= new Date().toISOString();
    document.user ??= { id: LOCAL_USER_ID, createdAt: document.startedAt };
    return document.user;
  });
  return result;
}

/** Forget the learner but keep their progress, so signing back in restores it. */
export async function signOut(): Promise<void> {
  await mutateDocument((document) => {
    document.user = null;
  });
}

export async function fetchGameState(now: number = Date.now()): Promise<GameState> {
  const { document } = await mutateDocument((current) => {
    applyHearts(current.game, settleHearts(current.game, now));
  });
  return toGameState(document, now);
}

export async function recordAnswer(
  params: {
    question: { id: string; type: string };
    lessonId: string;
    courseId: CourseId;
    isCorrect: boolean;
    isPractice?: boolean;
    attemptId?: string;
  },
  now: number = Date.now()
): Promise<AnswerOutcome> {
  const { result } = await mutateDocument((document) => {
    const unlimited = isSubscribed(document, now);

    // The same idempotency rule the RPC has: a replayed attempt is recorded
    // once and charged once.
    const alreadyRecorded =
      !!params.attemptId &&
      document.attempts.some((attempt) => attempt.attemptId === params.attemptId);

    if (alreadyRecorded) {
      applyHearts(document.game, settleHearts(document.game, now));
      return { heartsLeft: document.game.hearts, unlimitedHearts: unlimited };
    }

    document.attempts.push({
      questionId: params.question.id,
      lessonId: params.lessonId,
      courseId: params.courseId,
      isCorrect: params.isCorrect,
      at: new Date(now).toISOString(),
      attemptId: params.attemptId,
    });

    applyHearts(
      document.game,
      heartsAfterAnswer(
        document.game,
        {
          isCorrect: params.isCorrect,
          unlimited,
          isPractice: params.isPractice ?? false,
        },
        now
      )
    );

    return { heartsLeft: document.game.hearts, unlimitedHearts: unlimited };
  });

  return result;
}

export async function completeLesson(
  params: {
    lessonId: string;
    unitId: string;
    courseId: CourseId;
    correct: number;
    playedOn?: string;
  },
  now: number = Date.now()
): Promise<LessonResult> {
  const { document, result } = await mutateDocument((current) => {
    // The bundled lesson is the catalog: how many questions it has and what it
    // pays come from the content, never from the caller. An id that is not in
    // the bundle cannot be scored at all — treating it as a one-question lesson
    // would bank a 100% and a first completion for a lesson nobody played.
    const lesson = getLesson(params.lessonId);
    if (!lesson) throw new Error(`unknown lesson: ${params.lessonId}`);

    // A free learner is never shown the AI-graded question, so scoring them
    // against the whole lesson would cap every run they can play below a third
    // star. They are scored, and paid, over the part they were allowed to play.
    const premium = isSubscribed(current, now)
      ? []
      : lesson.questions.filter((question) => question.type === 'explain_code');
    const questions = Math.max(1, lesson.questions.length - premium.length);
    const baseXp = Math.max(
      0,
      getLessonBaseXp(lesson) -
        premium.reduce((sum, question) => sum + XP_BY_DIFFICULTY[question.difficulty], 0)
    );

    const score = scoreFor(params.correct, questions);
    const previous = current.lessons[params.lessonId];
    const bestBefore = previous?.bestScore ?? 0;
    const isFirstCompletion = previous?.status !== 'completed';

    const { award, perfectBonus } = lessonAward({ score, bestBefore, baseXp });

    const today = toIsoDate(now);
    const playedOn = clampPlayedOn(params.playedOn, today);
    const streak = streakAfter({
      lastActiveDate: current.game.lastActiveDate,
      playedOn,
      streakDays: current.game.streakDays,
      streakFreezes: current.game.streakFreezes,
    });

    const stars = starsForScore(score);
    const cleared = score >= PASS_SCORE;

    current.lessons[params.lessonId] = {
      lessonId: params.lessonId,
      unitId: params.unitId,
      courseId: params.courseId,
      status: cleared || previous?.status === 'completed' ? 'completed' : 'in_progress',
      bestScore: Math.max(bestBefore, score),
      stars: Math.max(previous?.stars ?? 0, stars),
      attempts: (previous?.attempts ?? 0) + 1,
      xpEarned: (previous?.xpEarned ?? 0) + award + perfectBonus,
      firstCompletedAt:
        previous?.firstCompletedAt ?? (cleared ? new Date(now).toISOString() : null),
    };

    const game = current.game;
    game.totalXp += award + perfectBonus + streak.bonus;
    game.streakDays = streak.streakDays;
    game.streakFreezes = streak.streakFreezes;
    game.longestStreak = Math.max(game.longestStreak, streak.streakDays);
    game.lastActiveDate =
      game.lastActiveDate && game.lastActiveDate > playedOn ? game.lastActiveDate : playedOn;
    if (isFirstCompletion && cleared) game.lessonsCompleted += 1;
    if (score === 100 && perfectBonus > 0) game.perfectLessons += 1;

    if (award > 0) current.xpEvents.push({ amount: award, source: 'lesson', earnedOn: playedOn });
    if (perfectBonus > 0) {
      current.xpEvents.push({ amount: perfectBonus, source: 'perfect_bonus', earnedOn: playedOn });
    }
    if (streak.bonus > 0) {
      current.xpEvents.push({ amount: streak.bonus, source: 'streak_bonus', earnedOn: playedOn });
    }

    return {
      totalXp: game.totalXp,
      xpAwarded: award + perfectBonus + streak.bonus,
      perfectBonus,
      streakBonus: streak.bonus,
      streakDays: streak.streakDays,
      hearts: game.hearts,
      stars,
      score,
      isFirstCompletion,
      dailyXp: 0,
    } satisfies LessonResult;
  });

  return { ...result, dailyXp: xpOn(document, toIsoDate(now)) };
}

export async function recordPractice(
  params: { correct: number; total: number },
  now: number = Date.now()
): Promise<{ xpAwarded: number; totalXp: number; dailyXp: number }> {
  // The same bounds the RPC refuses on: a practice run is at most one deck.
  if (
    params.total <= 0 ||
    params.total > 50 ||
    params.correct < 0 ||
    params.correct > params.total
  ) {
    throw new Error('implausible practice payload');
  }

  const { document, result } = await mutateDocument((current) => {
    const today = toIsoDate(now);
    const alreadyFromPractice = current.xpEvents
      .filter((event) => event.source === 'practice' && event.earnedOn === today)
      .reduce((sum, event) => sum + event.amount, 0);

    const award = practiceAward(params.correct, alreadyFromPractice);
    if (award > 0) {
      current.xpEvents.push({ amount: award, source: 'practice', earnedOn: today });
      current.game.totalXp += award;
    }
    return award;
  });

  return {
    xpAwarded: result,
    totalXp: document.game.totalXp,
    dailyXp: xpOn(document, toIsoDate(now)),
  };
}

export async function refillHearts(now: number = Date.now()): Promise<number> {
  const { result } = await mutateDocument((document) => {
    const unlimited = isSubscribed(document, now);
    if (!canRefillHearts(document.game.lastFreeRefillAt, unlimited, now)) {
      return null;
    }

    document.game.hearts = MAX_HEARTS;
    document.game.heartsUpdatedAt = new Date(now).toISOString();
    if (!unlimited) document.game.lastFreeRefillAt = new Date(now).toISOString();
    return document.game.hearts;
  });

  if (result === null) {
    throw new Error('hearts can only be refilled once a day on the free plan');
  }
  return result;
}

export async function fetchLessonProgress(courseId?: CourseId): Promise<LessonProgress[]> {
  const document = await readDocument();
  const rows = Object.values(document.lessons);
  return courseId ? rows.filter((row) => row.courseId === courseId) : rows;
}

/**
 * The questions the learner got wrong and has not since answered right, newest
 * miss first — the same shape `get_mistake_questions` returns.
 */
export async function fetchMistakeQuestionIds(courseId: CourseId, limit = 20): Promise<string[]> {
  const document = await readDocument();

  const latestCorrect = new Map<string, string>();
  for (const attempt of document.attempts) {
    if (attempt.isCorrect) latestCorrect.set(attempt.questionId, attempt.at);
  }

  const missed = new Map<string, string>();
  for (const attempt of document.attempts) {
    if (attempt.courseId !== courseId || attempt.isCorrect) continue;
    const fixedAt = latestCorrect.get(attempt.questionId);
    if (fixedAt && fixedAt > attempt.at) continue;
    // Later misses of the same question replace earlier ones.
    missed.set(attempt.questionId, attempt.at);
  }

  return [...missed.entries()]
    .sort(([, a], [, b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, Math.min(limit, 50))
    .map(([questionId]) => questionId);
}

export async function fetchProfile(): Promise<Profile | null> {
  const document = await readDocument();
  if (!document.user) return null;

  return {
    id: document.user.id,
    displayName: document.profile.displayName,
    avatarUrl: null,
    locale: document.profile.locale,
    activeCourse: document.profile.activeCourse,
    dailyGoalXp: document.profile.dailyGoalXp,
    reminderHour: document.profile.reminderHour,
    onboardingCompleted: document.profile.onboardingCompleted,
    experienceLevel: document.profile.experienceLevel,
    createdAt: document.startedAt ?? document.user.createdAt,
  };
}

export async function updateProfile(patch: {
  displayName?: string | null;
  locale?: SupportedLocale;
  activeCourse?: CourseId;
  dailyGoalXp?: number;
  reminderHour?: number | null;
  onboardingCompleted?: boolean;
  experienceLevel?: 'new' | 'some' | 'confident';
}): Promise<void> {
  await mutateDocument((document) => {
    document.profile = { ...document.profile, ...patch };
  });
}

export async function recordAiReview(questionId: string, verdict: ExplanationVerdict) {
  await mutateDocument((document) => {
    document.aiReviews.push({ questionId, verdict, at: new Date().toISOString() });
  });
}

export async function countPassedAiReviews(): Promise<number> {
  const document = await readDocument();
  return document.aiReviews.filter((review) => review.verdict !== 'incorrect').length;
}

/** Everything the learner has, gone. There is nowhere else it was stored. */
export async function deleteAccount(): Promise<void> {
  await resetDocument();
}

export async function readSubscription(now: number = Date.now()) {
  const document = await readDocument();
  return isSubscribed(document, now) ? document.subscription : null;
}

export async function grantSubscription(subscription: {
  productId: string;
  expiresAt: string;
  isTrial: boolean;
  willRenew: boolean;
}): Promise<void> {
  await mutateDocument((document) => {
    document.subscription = subscription;
  });
}
