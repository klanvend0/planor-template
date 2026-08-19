/**
 * The offline estimate.
 *
 * When a lesson is finished without a network, the number on the results screen
 * comes from here rather than from Postgres — so it has to follow the same rules
 * `complete_lesson` does, or the learner is shown XP the server will refuse.
 */

import { AppError } from '@/lib/errors';
import type { GameState, LessonProgress } from '@/services/progress_service';
import { useGameStore } from '@/stores/game_store';
import { useProgressStore } from '@/stores/progress_store';
import { useSyncQueue } from '@/stores/sync_queue';

jest.mock('@/services/progress_service', () => ({
  fetchGameState: jest.fn(),
  recordAnswer: jest.fn(),
  completeLesson: jest.fn(),
  refillHearts: jest.fn(),
}));

import { completeLesson, recordAnswer } from '@/services/progress_service';

const completeLessonMock = completeLesson as jest.MockedFunction<typeof completeLesson>;
const recordAnswerMock = recordAnswer as jest.MockedFunction<typeof recordAnswer>;

const TODAY = new Date().toISOString().slice(0, 10);
const dayBefore = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const gameState = (overrides: Partial<GameState> = {}): GameState => ({
  totalXp: 500,
  hearts: 5,
  heartsUpdatedAt: `${TODAY}T00:00:00Z`,
  streakDays: 3,
  longestStreak: 3,
  lastActiveDate: dayBefore(1),
  streakFreezes: 0,
  lessonsCompleted: 4,
  perfectLessons: 1,
  lastFreeRefillAt: null,
  dailyXp: 0,
  weeklyXp: 120,
  hasSubscription: false,
  ...overrides,
});

const progressRow = (overrides: Partial<LessonProgress> = {}): LessonProgress => ({
  lessonId: 'py-u01-l1',
  unitId: 'py-u01',
  courseId: 'python',
  status: 'completed',
  bestScore: 100,
  stars: 3,
  attempts: 1,
  xpEarned: 90,
  firstCompletedAt: `${dayBefore(2)}T00:00:00Z`,
  ...overrides,
});

const finishParams = {
  lessonId: 'py-u01-l1',
  unitId: 'py-u01',
  courseId: 'python' as const,
  correct: 6,
  total: 6,
  baseXp: 90,
};

beforeEach(() => {
  completeLessonMock.mockReset();
  recordAnswerMock.mockReset();
  completeLessonMock.mockRejectedValue(new AppError('network', 'offline'));
  recordAnswerMock.mockRejectedValue(new AppError('network', 'offline'));
  useProgressStore.setState({ byLesson: {}, loadedCourse: null });
  useSyncQueue.setState({ entries: [], flushing: false, ownerId: 'learner-1' });
});

describe('offline lesson estimate', () => {
  it('pays the full lesson the first time it is cleared', async () => {
    useGameStore.setState({ state: gameState() });

    const result = await useGameStore.getState().finishLesson(finishParams);

    expect(result.score).toBe(100);
    // 90 base + the perfect bonus.
    expect(result.xpAwarded).toBe(100);
    expect(result.perfectBonus).toBe(10);
    expect(result.isFirstCompletion).toBe(true);
    expect(result.stars).toBe(3);
  });

  it('pays nothing for replaying a lesson already at full marks', async () => {
    useGameStore.setState({ state: gameState() });
    useProgressStore.setState({ byLesson: { 'py-u01-l1': progressRow() } });

    const result = await useGameStore.getState().finishLesson(finishParams);

    expect(result.xpAwarded).toBe(0);
    expect(result.perfectBonus).toBe(0);
    expect(result.isFirstCompletion).toBe(false);
    expect(result.totalXp).toBe(500);
  });

  it('pays for the improvement only when a weaker run is beaten', async () => {
    useGameStore.setState({ state: gameState() });
    useProgressStore.setState({
      byLesson: { 'py-u01-l1': progressRow({ bestScore: 50, stars: 1 }) },
    });

    const result = await useGameStore.getState().finishLesson(finishParams);

    // 50 points of improvement over a 90 XP lesson, plus the perfect bonus.
    expect(result.xpAwarded).toBe(55);
    expect(result.perfectBonus).toBe(10);
  });

  it('advances the streak once a day, and not twice', async () => {
    useGameStore.setState({ state: gameState({ streakDays: 3, lastActiveDate: dayBefore(1) }) });
    expect((await useGameStore.getState().finishLesson(finishParams)).streakDays).toBe(4);

    useGameStore.setState({ state: gameState({ streakDays: 4, lastActiveDate: TODAY }) });
    expect((await useGameStore.getState().finishLesson(finishParams)).streakDays).toBe(4);
  });

  it('spends a freeze rather than resetting after one missed day', async () => {
    useGameStore.setState({
      state: gameState({ streakDays: 9, lastActiveDate: dayBefore(2), streakFreezes: 1 }),
    });
    expect((await useGameStore.getState().finishLesson(finishParams)).streakDays).toBe(10);

    useGameStore.setState({
      state: gameState({ streakDays: 9, lastActiveDate: dayBefore(2), streakFreezes: 0 }),
    });
    expect((await useGameStore.getState().finishLesson(finishParams)).streakDays).toBe(1);
  });

  it('spends the freeze it used, and banks the one it earned', async () => {
    useGameStore.setState({
      state: gameState({ streakDays: 9, lastActiveDate: dayBefore(2), streakFreezes: 1 }),
    });
    await useGameStore.getState().finishLesson(finishParams);
    // The rescued day cost the freeze; leaving it in place would rescue every
    // missed day until the next refresh.
    expect(useGameStore.getState().state?.streakFreezes).toBe(0);

    useGameStore.setState({ state: gameState({ streakDays: 6, lastActiveDate: dayBefore(1) }) });
    await useGameStore.getState().finishLesson(finishParams);
    expect(useGameStore.getState().state?.streakFreezes).toBe(1);
  });

  it('counts the lesson it just cleared', async () => {
    useGameStore.setState({ state: gameState({ lessonsCompleted: 4, perfectLessons: 1 }) });

    await useGameStore.getState().finishLesson(finishParams);

    const state = useGameStore.getState().state;
    expect(state?.lessonsCompleted).toBe(5);
    expect(state?.perfectLessons).toBe(2);
  });

  it('pays the seven-day bonus on the day the streak reaches it, once', async () => {
    useGameStore.setState({ state: gameState({ streakDays: 6, lastActiveDate: dayBefore(1) }) });
    const first = await useGameStore.getState().finishLesson(finishParams);
    expect(first.streakDays).toBe(7);
    expect(first.streakBonus).toBe(25);

    // A second lesson the same day is on the same streak day: no second bonus.
    useGameStore.setState({ state: gameState({ streakDays: 7, lastActiveDate: TODAY }) });
    expect((await useGameStore.getState().finishLesson(finishParams)).streakBonus).toBe(0);
  });
});

describe('offline answers', () => {
  it('queues the answer under the id the failed call already used', async () => {
    useGameStore.setState({ state: gameState() });

    await useGameStore.getState().submitAnswer({
      question: { id: 'py-u01-l1-q1', type: 'multiple_choice' },
      lessonId: 'py-u01-l1',
      courseId: 'python',
      isCorrect: false,
    });

    const sent = recordAnswerMock.mock.calls[0][0];
    const queued = useSyncQueue.getState().entries[0] as { payload: { attemptId?: string } };

    expect(sent.attemptId).toBeDefined();
    // Same id both times: the replay is what the server dedupes against.
    expect(queued.payload.attemptId).toBe(sent.attemptId);
  });

  it('spends a heart locally for a wrong answer, and none for a right one', async () => {
    useGameStore.setState({ state: gameState({ hearts: 3 }) });

    const wrong = await useGameStore.getState().submitAnswer({
      question: { id: 'py-u01-l1-q1', type: 'multiple_choice' },
      lessonId: 'py-u01-l1',
      courseId: 'python',
      isCorrect: false,
    });
    expect(wrong.heartsLeft).toBe(2);

    useGameStore.setState({ state: gameState({ hearts: 3 }) });
    const right = await useGameStore.getState().submitAnswer({
      question: { id: 'py-u01-l1-q2', type: 'multiple_choice' },
      lessonId: 'py-u01-l1',
      courseId: 'python',
      isCorrect: true,
    });
    expect(right.heartsLeft).toBe(3);
  });
});
