/**
 * Learner state in Postgres.
 *
 * Wraps the SECURITY DEFINER RPCs from `supabase/migrations` so screens and
 * stores never build queries themselves. XP, hearts and streaks are decided by
 * the database — this module only asks and reports.
 *
 * @module services/progress_service
 */

import { supabase } from '@/lib/supabase';
import { toAppError } from '@/lib/errors';
import type { CourseId, Question, QuestionType } from '@/lib/content_schema';
import type { SupportedLocale } from '@/lib/i18n';

export type GameState = {
  totalXp: number;
  hearts: number;
  heartsUpdatedAt: string;
  streakDays: number;
  longestStreak: number;
  lastActiveDate: string | null;
  streakFreezes: number;
  lessonsCompleted: number;
  perfectLessons: number;
  dailyXp: number;
  weeklyXp: number;
  hasSubscription: boolean;
};

export type LessonProgress = {
  lessonId: string;
  unitId: string;
  courseId: CourseId;
  status: 'in_progress' | 'completed';
  bestScore: number;
  stars: number;
  attempts: number;
  xpEarned: number;
  firstCompletedAt: string | null;
};

export type Profile = {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  locale: SupportedLocale;
  activeCourse: CourseId;
  dailyGoalXp: number;
  reminderHour: number | null;
  onboardingCompleted: boolean;
  experienceLevel: 'new' | 'some' | 'confident';
  createdAt: string;
};

export type LessonResult = {
  totalXp: number;
  xpAwarded: number;
  streakDays: number;
  hearts: number;
  stars: number;
  score: number;
  isFirstCompletion: boolean;
  dailyXp: number;
};

export type AnswerOutcome = {
  heartsLeft: number;
  unlimitedHearts: boolean;
};

/** Read the caller's game state; hearts are settled server-side on the way out. */
export async function fetchGameState(): Promise<GameState> {
  const { data, error } = await supabase.rpc('get_game_state');
  if (error) throw toAppError(error);

  const row = data?.[0];
  if (!row) throw toAppError(new Error('game state row missing'), 'unknown');

  return {
    totalXp: row.total_xp,
    hearts: row.hearts,
    heartsUpdatedAt: row.hearts_updated_at,
    streakDays: row.streak_days,
    longestStreak: row.longest_streak,
    lastActiveDate: row.last_active_date,
    streakFreezes: row.streak_freezes,
    lessonsCompleted: row.lessons_completed,
    perfectLessons: row.perfect_lessons,
    dailyXp: row.daily_xp,
    weeklyXp: row.weekly_xp,
    hasSubscription: row.has_subscription,
  };
}

/**
 * Log one answer. A wrong answer costs a heart unless the learner is a
 * subscriber; the server decides, the client only reports what happened.
 */
export async function recordAnswer(params: {
  question: Pick<Question, 'id' | 'type'>;
  lessonId: string;
  courseId: CourseId;
  isCorrect: boolean;
  answer?: string;
  durationMs?: number;
  /** Practice runs log the attempt but never spend a heart. */
  isPractice?: boolean;
}): Promise<AnswerOutcome> {
  const { data, error } = await supabase.rpc('record_answer', {
    p_question_id: params.question.id,
    p_lesson_id: params.lessonId,
    p_course_id: params.courseId,
    p_question_type: params.question.type satisfies QuestionType,
    p_is_correct: params.isCorrect,
    p_answer: params.answer ?? null,
    p_duration_ms: params.durationMs ?? null,
    p_practice: params.isPractice ?? false,
  });
  if (error) throw toAppError(error);

  const row = data?.[0];
  return {
    heartsLeft: row?.hearts_left ?? 0,
    unlimitedHearts: row?.unlimited_hearts ?? false,
  };
}

/** Close out a lesson and collect XP, stars and any streak bonus. */
export async function completeLesson(params: {
  lessonId: string;
  unitId: string;
  courseId: CourseId;
  correct: number;
  total: number;
  baseXp: number;
}): Promise<LessonResult> {
  const { data, error } = await supabase.rpc('complete_lesson', {
    p_lesson_id: params.lessonId,
    p_unit_id: params.unitId,
    p_course_id: params.courseId,
    p_correct: params.correct,
    p_total: params.total,
    p_base_xp: params.baseXp,
  });
  if (error) throw toAppError(error);

  const row = data?.[0];
  if (!row) throw toAppError(new Error('complete_lesson returned no row'), 'unknown');

  return {
    totalXp: row.total_xp,
    xpAwarded: row.xp_awarded,
    streakDays: row.streak_days,
    hearts: row.hearts,
    stars: row.stars,
    score: row.score,
    isFirstCompletion: row.is_first_completion,
    dailyXp: row.daily_xp,
  };
}

/**
 * Record a practice run over old questions.
 *
 * Worth less than a lesson on purpose (5 XP per correct answer, 50 XP a day) so
 * grinding the mistakes deck cannot replace learning something new.
 */
export async function recordPractice(params: {
  courseId: CourseId;
  correct: number;
  total: number;
}): Promise<{ xpAwarded: number; totalXp: number; dailyXp: number }> {
  const { data, error } = await supabase.rpc('record_practice', {
    p_course_id: params.courseId,
    p_correct: params.correct,
    p_total: params.total,
  });
  if (error) throw toAppError(error);

  const row = data?.[0];
  return {
    xpAwarded: row?.xp_awarded ?? 0,
    totalXp: row?.total_xp ?? 0,
    dailyXp: row?.daily_xp ?? 0,
  };
}

/** Refill hearts. Free once per day; unlimited for subscribers. */
export async function refillHearts(): Promise<number> {
  const { data, error } = await supabase.rpc('refill_hearts');
  if (error) throw toAppError(error);
  return data ?? 0;
}

/** Every lesson the learner has touched in a course. */
export async function fetchLessonProgress(courseId: CourseId): Promise<LessonProgress[]> {
  const { data, error } = await supabase
    .from('lesson_progress')
    .select(
      'lesson_id, unit_id, course_id, status, best_score, stars, attempts, xp_earned, first_completed_at'
    )
    .eq('course_id', courseId);
  if (error) throw toAppError(error);

  return (data ?? []).map((row) => ({
    lessonId: row.lesson_id,
    unitId: row.unit_id,
    courseId: row.course_id,
    status: row.status,
    bestScore: row.best_score,
    stars: row.stars,
    attempts: row.attempts,
    xpEarned: row.xp_earned,
    firstCompletedAt: row.first_completed_at,
  }));
}

/** Every lesson row the learner has, across all courses, for profile stats. */
export async function fetchAllLessonProgress(): Promise<LessonProgress[]> {
  const { data, error } = await supabase
    .from('lesson_progress')
    .select(
      'lesson_id, unit_id, course_id, status, best_score, stars, attempts, xp_earned, first_completed_at'
    );
  if (error) throw toAppError(error);

  return (data ?? []).map((row) => ({
    lessonId: row.lesson_id,
    unitId: row.unit_id,
    courseId: row.course_id,
    status: row.status,
    bestScore: row.best_score,
    stars: row.stars,
    attempts: row.attempts,
    xpEarned: row.xp_earned,
    firstCompletedAt: row.first_completed_at,
  }));
}

/** Question ids the learner got wrong and has not since fixed. */
export async function fetchMistakeQuestionIds(courseId: CourseId, limit = 20): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_mistake_questions', {
    p_course_id: courseId,
    p_limit: limit,
  });
  if (error) throw toAppError(error);
  return (data ?? []).map((row) => row.question_id);
}

/** The caller's profile row, created by the `handle_new_user` trigger. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    locale: data.locale,
    activeCourse: data.active_course,
    dailyGoalXp: data.daily_goal_xp,
    reminderHour: data.reminder_hour,
    onboardingCompleted: data.onboarding_completed,
    experienceLevel: data.experience_level,
    createdAt: data.created_at,
  };
}

/** Patch profile preferences captured during onboarding or in settings. */
export async function updateProfile(
  userId: string,
  patch: Partial<{
    displayName: string | null;
    locale: SupportedLocale;
    activeCourse: CourseId;
    dailyGoalXp: number;
    reminderHour: number | null;
    onboardingCompleted: boolean;
    experienceLevel: 'new' | 'some' | 'confident';
  }>
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
      ...(patch.activeCourse !== undefined ? { active_course: patch.activeCourse } : {}),
      ...(patch.dailyGoalXp !== undefined ? { daily_goal_xp: patch.dailyGoalXp } : {}),
      ...(patch.reminderHour !== undefined ? { reminder_hour: patch.reminderHour } : {}),
      ...(patch.onboardingCompleted !== undefined
        ? { onboarding_completed: patch.onboardingCompleted }
        : {}),
      ...(patch.experienceLevel !== undefined ? { experience_level: patch.experienceLevel } : {}),
    })
    .eq('id', userId);
  if (error) throw toAppError(error);
}

/** How many AI-graded explanations the learner has passed, for achievements. */
export async function countPassedAiReviews(): Promise<number> {
  const { count, error } = await supabase
    .from('ai_reviews')
    .select('id', { count: 'exact', head: true })
    .in('verdict', ['correct', 'partial']);
  if (error) throw toAppError(error);
  return count ?? 0;
}
