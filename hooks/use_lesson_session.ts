/**
 * Lesson session state machine.
 *
 * Owns everything that happens between opening a lesson and seeing the results:
 * the question queue, re-queuing what was missed, hearts, XP and the AI-graded
 * explanation. Screens render what this returns and call its actions — they hold
 * no session state of their own.
 *
 * @module hooks/use_lesson_session
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { checkAnswer, type AnswerInput, type CheckResult } from '@/lib/answer_check';
import { isPremiumQuestion, questionXp, type Lesson, type Question } from '@/lib/content_schema';
import { starsForScore } from '@/lib/gamification';
import { correctFeedback, incorrectFeedback } from '@/lib/haptics';
import { toAppError, type AppError } from '@/lib/errors';
import { getQuestionLocation, type LessonLocation } from '@/services/content_service';
import { gradeExplanation, type ExplanationReview } from '@/services/grading_service';
import { recordPractice, type LessonResult } from '@/services/progress_service';
import { useGameStore } from '@/stores/game_store';
import { useSettingsStore } from '@/stores/settings_store';

export type SessionPhase =
  /** The teaching card shown before the first question. */
  | 'concept'
  /** Waiting for an answer. */
  | 'question'
  /** Answer submitted, feedback on screen. */
  | 'feedback'
  /** No hearts left; the learner must wait, refill or subscribe. */
  | 'out_of_hearts'
  /** Every question answered. */
  | 'finished';

export type SessionState = {
  phase: SessionPhase;
  question: Question | null;
  /**
   * Changes every time a question is presented, including when the same
   * question comes back after being missed. Screens key their draft state on
   * this rather than on the question id, which would not change if a re-queued
   * question is the only one left.
   */
  presentation: number;
  /** 1-based position across the *original* question list, for the progress bar. */
  position: number;
  total: number;
  /** 0..1 progress, counting re-queued questions as already seen. */
  progress: number;
  lastResult: CheckResult | null;
  /** AI feedback for the current explain_code question, when it has been graded. */
  review: ExplanationReview | null;
  isGrading: boolean;
  isFinishing: boolean;
  error: AppError | null;
  correctCount: number;
  /** Result of `complete_lesson`, available once the phase is `finished`. */
  outcome: LessonResult | null;
  elapsedMs: number;
};

export type LessonSession = SessionState & {
  /** Leave the teaching card and show the first question. */
  begin: () => void;
  /** Grade a non-AI answer. */
  submit: (input: AnswerInput) => Promise<void>;
  /** Send an explanation to the AI grader, then grade the question with its verdict. */
  submitExplanation: (text: string) => Promise<ExplanationReview | null>;
  /** Skip the current question without answering (premium questions when free). */
  skip: () => void;
  /** Advance after feedback. */
  next: () => Promise<void>;
  /** Retry after hearts were refilled. */
  resume: () => void;
  clearError: () => void;
};

export type SessionOptions = {
  /**
   * Play these questions instead of the lesson's own — used by the mistakes deck
   * and quick review, which pull questions from across the course.
   */
  questions?: Question[];
  /**
   * `lesson` completes the lesson and pays full XP; `practice` only logs the
   * answers and pays the smaller practice reward.
   */
  mode?: 'lesson' | 'practice';
};

/**
 * Drive one lesson or practice run.
 *
 * @param location - The lesson plus the unit and course it belongs to. For a
 * practice run this is the lesson the first question came from; it supplies the
 * course and unit ids the answer log needs.
 * @param options - See {@link SessionOptions}.
 */
export function useLessonSession(
  location: LessonLocation,
  options?: SessionOptions
): LessonSession {
  const lesson: Lesson = location.lesson;
  const mode = options?.mode ?? 'lesson';
  const sourceQuestions = useMemo(
    () => options?.questions ?? lesson.questions,
    [options?.questions, lesson.questions]
  );
  const locale = useSettingsStore((state) => state.locale);
  const gameState = useGameStore((state) => state.state);
  const submitAnswer = useGameStore((state) => state.submitAnswer);
  const finishLesson = useGameStore((state) => state.finishLesson);

  const [queue, setQueue] = useState<Question[]>(() => [...sourceQuestions]);
  const [phase, setPhase] = useState<SessionPhase>('concept');
  const [lastResult, setLastResult] = useState<CheckResult | null>(null);
  const [review, setReview] = useState<ExplanationReview | null>(null);
  const [isGrading, setIsGrading] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [outcome, setOutcome] = useState<LessonResult | null>(null);
  const [presentation, setPresentation] = useState(0);

  /** Questions answered right the first time — this is what the score is made of. */
  const firstTryCorrect = useRef(new Set<string>());
  /** Questions already sent to the back of the queue, so they re-queue only once. */
  const requeued = useRef(new Set<string>());
  /** Questions the learner has seen, for the question counter. */
  const seen = useRef(new Set<string>());
  /** Questions that will not be asked again — right, or already retried once. */
  const resolved = useRef(new Set<string>());
  /**
   * Questions skipped rather than answered — in practice the AI-graded one when
   * the learner is on the free plan. They leave the denominator, so a free
   * learner can still finish a lesson at 100% instead of being capped at 5/6.
   */
  const skipped = useRef(new Set<string>());
  const [skippedCount, setSkippedCount] = useState(0);
  const questionStartedAt = useRef(Date.now());
  const sessionStartedAt = useRef(Date.now());

  const question = queue[0] ?? null;
  const total = Math.max(1, sourceQuestions.length - skippedCount);

  const state = useMemo<SessionState>(
    () => ({
      phase,
      question,
      presentation,
      // During feedback the counter stays on the question being discussed
      // rather than jumping ahead to the next one.
      position: Math.min(total, Math.max(1, resolved.current.size + (question ? 1 : 0))),
      total,
      // Progress counts questions that are done with, so finishing a lesson
      // always fills the bar — even one that took a second attempt.
      progress: total === 0 ? 0 : Math.min(1, resolved.current.size / total),
      lastResult,
      review,
      isGrading,
      isFinishing,
      error,
      correctCount: firstTryCorrect.current.size,
      outcome,
      elapsedMs: Date.now() - sessionStartedAt.current,
    }),
    [
      phase,
      question,
      total,
      lastResult,
      review,
      isGrading,
      isFinishing,
      error,
      outcome,
      skippedCount,
    ]
  );

  const begin = useCallback(() => {
    questionStartedAt.current = Date.now();
    sessionStartedAt.current = Date.now();
    setPhase('question');
  }, []);

  /** Report the answer, spend a heart when needed, and show feedback. */
  const settle = useCallback(
    async (current: Question, result: CheckResult) => {
      seen.current.add(current.id);

      if (result.isCorrect) {
        if (!requeued.current.has(current.id)) firstTryCorrect.current.add(current.id);
        void correctFeedback();
      } else {
        void incorrectFeedback();
      }

      // The queue is updated before anything is awaited: a learner who taps
      // Continue while the write is still in flight must not lose the retry.
      if (result.isCorrect || requeued.current.has(current.id)) {
        // Right, or already had its second chance: it will not come back.
        resolved.current.add(current.id);
      } else {
        requeued.current.add(current.id);
        setQueue((items) => [...items, current]);
      }

      setLastResult(result);
      setPhase('feedback');

      const answeredAt = presentation;

      try {
        // In a practice run the questions come from all over the course, so the
        // attempt is logged against the lesson that actually owns the question.
        const owner = getQuestionLocation(current.id);
        const outcomeOfAnswer = await submitAnswer({
          question: current,
          lessonId: owner?.lesson.id ?? lesson.id,
          courseId: owner?.course.id ?? location.course.id,
          isCorrect: result.isCorrect,
          answer: result.submitted,
          durationMs: Date.now() - questionStartedAt.current,
          isPractice: mode === 'practice',
        });

        // Only interrupt if the learner is still looking at this answer; they
        // may have moved on while the request was in flight.
        if (
          !result.isCorrect &&
          !outcomeOfAnswer.unlimitedHearts &&
          outcomeOfAnswer.heartsLeft <= 0 &&
          answeredAt === presentation
        ) {
          setPhase('out_of_hearts');
        }
      } catch (caught) {
        // Feedback is already on screen; a failed write must not eat the answer.
        setError(toAppError(caught));
      }
    },
    [lesson.id, location.course.id, mode, presentation, submitAnswer]
  );

  const submit = useCallback(
    async (input: AnswerInput) => {
      if (!question || phase !== 'question') return;
      const result = checkAnswer(question, input);
      await settle(question, result);
    },
    [phase, question, settle]
  );

  const submitExplanation = useCallback(
    async (text: string) => {
      if (!question || question.type !== 'explain_code' || phase !== 'question') return null;

      setIsGrading(true);
      setError(null);
      try {
        const graded = await gradeExplanation({
          questionId: question.id,
          answer: text,
          locale,
        });
        setReview(graded);
        await settle(
          question,
          checkAnswer(question, { type: 'explain_code', verdict: graded.verdict })
        );
        return graded;
      } catch (caught) {
        setError(toAppError(caught));
        return null;
      } finally {
        setIsGrading(false);
      }
    },
    [locale, phase, question, settle]
  );

  const finish = useCallback(async () => {
    setIsFinishing(true);
    const correct = firstTryCorrect.current.size;
    // Read the skipped set rather than the rendered count: skipping the last
    // question queues a state update that has not landed by the time this runs.
    const played = Math.max(1, sourceQuestions.length - skipped.current.size);

    try {
      if (mode === 'practice') {
        const practice = await recordPractice({
          courseId: location.course.id,
          correct,
          total: played,
        });
        const score = Math.round((correct / played) * 100);
        setOutcome({
          totalXp: practice.totalXp,
          xpAwarded: practice.xpAwarded,
          perfectBonus: 0,
          streakBonus: 0,
          streakDays: gameState?.streakDays ?? 0,
          hearts: gameState?.hearts ?? 0,
          stars: starsForScore(score),
          score,
          isFirstCompletion: false,
          dailyXp: practice.dailyXp,
        });
      } else {
        // Skipped questions leave the reward too, not just the denominator —
        // otherwise skipping the premium question would pay for itself.
        const baseXp = sourceQuestions
          .filter((entry) => !skipped.current.has(entry.id))
          .reduce((sum, entry) => sum + questionXp(entry), 0);

        const result = await finishLesson({
          lessonId: lesson.id,
          unitId: location.unit.id,
          courseId: location.course.id,
          correct,
          total: played,
          baseXp,
        });
        setOutcome(result);
      }
    } catch (caught) {
      setError(toAppError(caught));
    } finally {
      setIsFinishing(false);
      setPhase('finished');
    }
  }, [
    finishLesson,
    gameState?.hearts,
    gameState?.streakDays,
    lesson,
    location.course.id,
    location.unit.id,
    mode,
    sourceQuestions,
  ]);

  const advance = useCallback(async () => {
    setLastResult(null);
    setReview(null);
    setPresentation((value) => value + 1);
    questionStartedAt.current = Date.now();

    const remaining = queue.slice(1);
    setQueue(remaining);

    if (remaining.length === 0) {
      await finish();
      return;
    }
    setPhase('question');
  }, [finish, queue]);

  const skip = useCallback(() => {
    if (!question) return;
    seen.current.add(question.id);
    if (!skipped.current.has(question.id)) {
      skipped.current.add(question.id);
      setSkippedCount(skipped.current.size);
    }
    resolved.current.delete(question.id);
    void advance();
  }, [advance, question]);

  const resume = useCallback(() => {
    if (phase !== 'out_of_hearts') return;
    // The question that emptied the hearts was already answered and its feedback
    // computed, so the learner returns to that feedback rather than being asked
    // it again with the answer showing.
    setPhase(lastResult ? 'feedback' : 'question');
  }, [lastResult, phase]);

  return {
    ...state,
    begin,
    submit,
    submitExplanation,
    skip,
    next: advance,
    resume,
    clearError: () => setError(null),
  };
}

/** XP a lesson pays out at 100%, shown on the lesson card before starting. */
export function lessonRewardXp(lesson: Lesson): number {
  return lesson.questions.reduce((total, question) => total + questionXp(question), 0);
}

/** True when the question needs a subscription to answer. */
export function requiresSubscription(question: Question, hasSubscription: boolean): boolean {
  return isPremiumQuestion(question) && !hasSubscription;
}
