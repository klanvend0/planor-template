/**
 * The device-as-backend.
 *
 * A fresh clone with no `.env` plays the whole game through this module, so it
 * is tested the way the RPCs it replaces are described: against the real
 * bundled content, one learner, one device, over several days.
 */

import { XP_BY_DIFFICULTY } from '@/lib/content_schema';
import { MAX_HEARTS } from '@/lib/gamification';
import { getLesson, getLessonBaseXp } from '@/services/content_service';
import * as backend from '@/services/local/backend';
import { resetDocument } from '@/services/local/document';

const LESSON = 'py-u01-l1';
const UNIT = 'py-u01';
const lesson = getLesson(LESSON)!;

// A free learner never sees the AI-graded question, so the lesson they play is
// the rest of it — which is what they are scored and paid over.
const PREMIUM = lesson.questions.filter((question) => question.type === 'explain_code');
const PREMIUM_XP = PREMIUM.reduce((sum, q) => sum + XP_BY_DIFFICULTY[q.difficulty], 0);
const QUESTIONS = lesson.questions.length - PREMIUM.length;
const BASE_XP = getLessonBaseXp(lesson) - PREMIUM_XP;
const FULL_QUESTIONS = lesson.questions.length;
const FULL_BASE_XP = getLessonBaseXp(lesson);

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-19T12:00:00Z');
const day = (offset: number) => new Date(NOW + offset * DAY).toISOString().slice(0, 10);

const finish = (correct: number, at = NOW, playedOn?: string) =>
  backend.completeLesson(
    { lessonId: LESSON, unitId: UNIT, courseId: 'python', correct, playedOn },
    at
  );

const answer = (questionId: string, isCorrect: boolean, extra: Record<string, unknown> = {}) =>
  backend.recordAnswer(
    {
      question: { id: questionId, type: 'multiple_choice' },
      lessonId: LESSON,
      courseId: 'python',
      isCorrect,
      ...extra,
    },
    NOW
  );

beforeEach(async () => {
  await resetDocument();
  await backend.signIn();
});

describe('lessons', () => {
  it('pays the part of the lesson a free learner can play, not what the caller claims', async () => {
    const result = await finish(QUESTIONS);

    expect(result.score).toBe(100);
    expect(result.xpAwarded).toBe(BASE_XP + 10);
    expect(result.stars).toBe(3);
    expect(result.isFirstCompletion).toBe(true);

    const state = await backend.fetchGameState(NOW);
    expect(state.totalXp).toBe(BASE_XP + 10);
    expect(state.lessonsCompleted).toBe(1);
    expect(state.perfectLessons).toBe(1);
    expect(state.dailyXp).toBe(BASE_XP + 10);
  });

  it('pays nothing for replaying a lesson already at full marks', async () => {
    await finish(QUESTIONS);
    const replay = await finish(QUESTIONS);

    expect(replay.xpAwarded).toBe(0);
    expect(replay.isFirstCompletion).toBe(false);
    expect((await backend.fetchGameState(NOW)).totalXp).toBe(BASE_XP + 10);

    const [row] = await backend.fetchLessonProgress('python');
    expect(row.attempts).toBe(2);
    expect((await backend.fetchGameState(NOW)).lessonsCompleted).toBe(1);
  });

  it('keeps the best score when a later run goes worse', async () => {
    await finish(QUESTIONS);
    await finish(1);

    const [row] = await backend.fetchLessonProgress('python');
    expect(row.bestScore).toBe(100);
    expect(row.stars).toBe(3);
    expect(row.status).toBe('completed');
  });

  it('leaves a failed first attempt open, and does not spend the first completion', async () => {
    const failed = await finish(1);
    expect(failed.score).toBeLessThan(50);

    const [row] = await backend.fetchLessonProgress('python');
    expect(row.status).toBe('in_progress');
    expect((await backend.fetchGameState(NOW)).lessonsCompleted).toBe(0);

    const cleared = await finish(QUESTIONS);
    expect(cleared.isFirstCompletion).toBe(true);
    expect((await backend.fetchGameState(NOW)).lessonsCompleted).toBe(1);
  });
});

describe('bad input', () => {
  it('refuses a lesson id that is not in the bundle', async () => {
    await expect(
      backend.completeLesson(
        { lessonId: 'ghost-lesson', unitId: UNIT, courseId: 'python', correct: 1 },
        NOW
      )
    ).rejects.toThrow(/unknown lesson/);
    expect((await backend.fetchGameState(NOW)).totalXp).toBe(0);
    expect(await backend.fetchLessonProgress('python')).toEqual([]);
  });

  it('refuses a practice payload the server would refuse', async () => {
    await expect(backend.recordPractice({ correct: 0, total: 0 }, NOW)).rejects.toThrow();
    await expect(backend.recordPractice({ correct: 9, total: 6 }, NOW)).rejects.toThrow();
    await expect(backend.recordPractice({ correct: 60, total: 60 }, NOW)).rejects.toThrow();
    expect((await backend.fetchGameState(NOW)).totalXp).toBe(0);
  });
});

describe('streak', () => {
  it('extends day by day and pays on the seventh', async () => {
    for (let index = 0; index < 6; index += 1) {
      await finish(QUESTIONS, NOW + index * DAY, day(index));
    }
    expect((await backend.fetchGameState(NOW + 5 * DAY)).streakDays).toBe(6);

    const seventh = await finish(QUESTIONS, NOW + 6 * DAY, day(6));
    expect(seventh.streakDays).toBe(7);
    expect(seventh.streakBonus).toBe(25);
    expect((await backend.fetchGameState(NOW + 6 * DAY)).streakFreezes).toBe(1);
  });

  it('refuses to date a lesson further back than the server would', async () => {
    await finish(QUESTIONS, NOW, day(-30));
    expect((await backend.fetchGameState(NOW)).lastActiveDate).toBe(day(-2));
  });
});

describe('hearts', () => {
  it('spends one per wrong answer and stops at zero', async () => {
    for (let index = 0; index < MAX_HEARTS + 2; index += 1) {
      await answer(`${LESSON}-q${index}`, false);
    }
    expect((await backend.fetchGameState(NOW)).hearts).toBe(0);
  });

  it('never spends one in practice', async () => {
    await answer(`${LESSON}-q1`, false, { isPractice: true });
    expect((await backend.fetchGameState(NOW)).hearts).toBe(MAX_HEARTS);
  });

  it('charges a replayed answer only once', async () => {
    await answer(`${LESSON}-q1`, false, { attemptId: 'attempt-1' });
    const replay = await answer(`${LESSON}-q1`, false, { attemptId: 'attempt-1' });

    expect(replay.heartsLeft).toBe(MAX_HEARTS - 1);
    expect((await backend.fetchGameState(NOW)).hearts).toBe(MAX_HEARTS - 1);
  });

  it('refills once a day on the free plan', async () => {
    await answer(`${LESSON}-q1`, false);
    expect(await backend.refillHearts(NOW)).toBe(MAX_HEARTS);

    await answer(`${LESSON}-q2`, false);
    await expect(backend.refillHearts(NOW + 60_000)).rejects.toThrow();
    expect(await backend.refillHearts(NOW + 25 * 3_600_000)).toBe(MAX_HEARTS);
  });

  it('reports the spent refill, so the screen can stop offering it', async () => {
    expect((await backend.fetchGameState(NOW)).lastFreeRefillAt).toBeNull();

    await answer(`${LESSON}-q1`, false);
    await backend.refillHearts(NOW);

    expect((await backend.fetchGameState(NOW)).lastFreeRefillAt).not.toBeNull();
  });

  it('regenerates one every half hour', async () => {
    await answer(`${LESSON}-q1`, false);
    await answer(`${LESSON}-q2`, false);
    expect((await backend.fetchGameState(NOW)).hearts).toBe(3);
    expect((await backend.fetchGameState(NOW + 31 * 60_000)).hearts).toBe(4);
  });
});

describe('practice', () => {
  it('pays five a question up to a daily cap', async () => {
    expect((await backend.recordPractice({ correct: 6, total: 6 }, NOW)).xpAwarded).toBe(30);
    expect((await backend.recordPractice({ correct: 6, total: 6 }, NOW)).xpAwarded).toBe(20);
    expect((await backend.recordPractice({ correct: 6, total: 6 }, NOW)).xpAwarded).toBe(0);
    expect((await backend.recordPractice({ correct: 6, total: 6 }, NOW + DAY)).xpAwarded).toBe(30);
  });
});

describe('mistakes deck', () => {
  it('holds a question until it is answered right, newest miss first', async () => {
    await answer('q-old', false);
    await backend.recordAnswer(
      {
        question: { id: 'q-new', type: 'multiple_choice' },
        lessonId: LESSON,
        courseId: 'python',
        isCorrect: false,
      },
      NOW + 60_000
    );

    expect(await backend.fetchMistakeQuestionIds('python')).toEqual(['q-new', 'q-old']);

    await backend.recordAnswer(
      {
        question: { id: 'q-old', type: 'multiple_choice' },
        lessonId: LESSON,
        courseId: 'python',
        isCorrect: true,
      },
      NOW + 120_000
    );
    expect(await backend.fetchMistakeQuestionIds('python')).toEqual(['q-new']);
  });

  it('still owes a question after hundreds of later answers', async () => {
    await answer('q-missed-long-ago', false);

    // One pass of the bundled content is over 300 answers; the deck must not
    // forget a miss just because the learner kept playing.
    for (let index = 0; index < 800; index += 1) {
      await backend.recordAnswer(
        {
          question: { id: `q-filler-${index}`, type: 'multiple_choice' },
          lessonId: LESSON,
          courseId: 'python',
          isCorrect: true,
        },
        NOW + index * 1000
      );
    }

    expect(await backend.fetchMistakeQuestionIds('python')).toContain('q-missed-long-ago');
  });

  it('keeps the other course out of it', async () => {
    await backend.recordAnswer(
      {
        question: { id: 'js-q', type: 'multiple_choice' },
        lessonId: 'js-u01-l1',
        courseId: 'javascript',
        isCorrect: false,
      },
      NOW
    );
    expect(await backend.fetchMistakeQuestionIds('python')).toEqual([]);
    expect(await backend.fetchMistakeQuestionIds('javascript')).toEqual(['js-q']);
  });
});

describe('subscription', () => {
  it('reports Pro only while the period is open', async () => {
    await backend.grantSubscription({
      productId: 'local.annual',
      expiresAt: new Date(NOW + DAY).toISOString(),
      isTrial: true,
      willRenew: true,
    });

    expect((await backend.fetchGameState(NOW)).hasSubscription).toBe(true);
    expect((await backend.fetchGameState(NOW + 2 * DAY)).hasSubscription).toBe(false);
  });

  it('scores a subscriber over the whole lesson, premium question included', async () => {
    await backend.grantSubscription({
      productId: 'local.annual',
      expiresAt: new Date(NOW + DAY).toISOString(),
      isTrial: false,
      willRenew: true,
    });

    const result = await finish(FULL_QUESTIONS);
    expect(result.score).toBe(100);
    expect(result.xpAwarded).toBe(FULL_BASE_XP + 10);

    // The same run without the premium answer is no longer a perfect one for
    // them: they could have answered it.
    await backend.deleteAccount();
    await backend.signIn();
    await backend.grantSubscription({
      productId: 'local.annual',
      expiresAt: new Date(NOW + DAY).toISOString(),
      isTrial: false,
      willRenew: true,
    });
    expect((await finish(QUESTIONS)).score).toBeLessThan(100);
  });

  it('stops hearts being spent while it is open', async () => {
    await backend.grantSubscription({
      productId: 'local.annual',
      expiresAt: new Date(NOW + DAY).toISOString(),
      isTrial: false,
      willRenew: true,
    });

    const outcome = await answer(`${LESSON}-q1`, false);
    expect(outcome.unlimitedHearts).toBe(true);
    expect(outcome.heartsLeft).toBe(MAX_HEARTS);
  });
});

describe('account', () => {
  it('keeps progress across a sign-out and loses it on delete', async () => {
    await finish(QUESTIONS);
    await backend.signOut();
    expect(await backend.currentUser()).toBeNull();

    await backend.signIn();
    expect((await backend.fetchGameState(NOW)).totalXp).toBe(BASE_XP + 10);

    await backend.deleteAccount();
    expect(await backend.currentUser()).toBeNull();
    expect((await backend.fetchGameState(NOW)).totalXp).toBe(0);
    expect(await backend.fetchLessonProgress('python')).toEqual([]);
  });

  it('remembers the preferences onboarding captured', async () => {
    await backend.updateProfile({ locale: 'tr', activeCourse: 'javascript', dailyGoalXp: 100 });
    const profile = await backend.fetchProfile();

    expect(profile).toMatchObject({ locale: 'tr', activeCourse: 'javascript', dailyGoalXp: 100 });
  });
});
