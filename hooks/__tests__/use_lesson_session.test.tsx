/**
 * The lesson state machine decides what a learner is asked, what they score and
 * what they are paid, so its queue, progress and finish rules are pinned here.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useLessonSession } from '@/hooks/use_lesson_session';
import type { Lesson, Question } from '@/lib/content_schema';
import type { LessonLocation } from '@/services/content_service';

// Jest hoists mock factories, so these have to be `mock`-prefixed to be usable
// inside them.
const mockSubmitAnswer = jest.fn();
const mockFinishLesson = jest.fn();

const mockGameState = {
  totalXp: 0,
  hearts: 5,
  heartsUpdatedAt: '2026-08-18T00:00:00Z',
  streakDays: 0,
  longestStreak: 0,
  lastActiveDate: null,
  streakFreezes: 0,
  lessonsCompleted: 0,
  perfectLessons: 0,
  dailyXp: 0,
  weeklyXp: 0,
  hasSubscription: false,
};

jest.mock('@/stores/game_store', () => ({
  useGameStore: (selector: (state: unknown) => unknown) =>
    selector({
      state: mockGameState,
      submitAnswer: mockSubmitAnswer,
      finishLesson: mockFinishLesson,
    }),
}));

jest.mock('@/stores/settings_store', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ locale: 'en' }),
  // Read by lib/haptics outside React.
  settingsSnapshot: () => ({ hapticsEnabled: false }),
}));

jest.mock('@/services/grading_service', () => ({ gradeExplanation: jest.fn() }));
jest.mock('@/services/progress_service', () => ({ recordPractice: jest.fn() }));

const localized = (value: string) => ({ en: value, tr: value });

function choice(id: string, answerId = 'a'): Question {
  return {
    id,
    type: 'multiple_choice',
    difficulty: 'easy',
    prompt: localized('Pick one'),
    explanation: localized('Because.'),
    options: [
      { id: 'a', text: localized('right') },
      { id: 'b', text: localized('wrong') },
      { id: 'c', text: localized('also wrong') },
      { id: 'd', text: localized('still wrong') },
    ],
    answerId,
  };
}

function makeLocation(questions: Question[]): LessonLocation {
  const lesson: Lesson = {
    id: 'py-u01-l1',
    index: 1,
    title: localized('Printing'),
    concept: {
      headline: localized('print() shows a value'),
      body: localized('A long enough body for the schema, though nothing here validates it.'),
      example: { code: 'print(1)', caption: localized('One line.') },
    },
    questions,
  };

  return {
    course: {
      id: 'python',
      language: 'python',
      title: localized('Python'),
      tagline: localized('Friendly'),
      accent: 'hsl(0 0% 0%)',
      units: [],
    },
    unit: {
      id: 'py-u01',
      courseId: 'python',
      index: 1,
      title: localized('First steps'),
      description: localized('The beginning'),
      lessons: [lesson],
    },
    lesson,
    courseIndex: 0,
  };
}

beforeEach(() => {
  mockSubmitAnswer.mockReset();
  mockFinishLesson.mockReset();
  mockSubmitAnswer.mockResolvedValue({ heartsLeft: 5, unlimitedHearts: false });
  mockFinishLesson.mockResolvedValue({
    totalXp: 20,
    xpAwarded: 20,
    perfectBonus: 0,
    streakBonus: 0,
    streakDays: 1,
    hearts: 5,
    stars: 3,
    score: 100,
    isFirstCompletion: true,
    dailyXp: 20,
  });
});

describe('useLessonSession', () => {
  it('starts on the teaching card and moves to the first question', () => {
    const { result } = renderHook(() => useLessonSession(makeLocation([choice('q1')])));

    expect(result.current.phase).toBe('concept');
    act(() => result.current.begin());
    expect(result.current.phase).toBe('question');
    expect(result.current.question?.id).toBe('q1');
    expect(result.current.total).toBe(1);
  });

  it('advances through a clean run and reports every answer', async () => {
    const location = makeLocation([choice('q1'), choice('q2')]);
    const { result } = renderHook(() => useLessonSession(location));

    act(() => result.current.begin());

    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'a' });
    });
    expect(result.current.phase).toBe('feedback');
    expect(result.current.lastResult?.isCorrect).toBe(true);
    expect(result.current.progress).toBe(0.5);

    await act(async () => {
      await result.current.next();
    });
    expect(result.current.question?.id).toBe('q2');

    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'a' });
    });
    await act(async () => {
      await result.current.next();
    });

    await waitFor(() => expect(result.current.phase).toBe('finished'));
    expect(mockSubmitAnswer).toHaveBeenCalledTimes(2);
    expect(mockFinishLesson).toHaveBeenCalledWith(
      expect.objectContaining({ lessonId: 'py-u01-l1', correct: 2, total: 2 })
    );
  });

  it('asks a missed question again and still fills the bar once it is fixed', async () => {
    const { result } = renderHook(() => useLessonSession(makeLocation([choice('q1')])));

    act(() => result.current.begin());

    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'b' });
    });
    expect(result.current.lastResult?.isCorrect).toBe(false);
    // The retry is queued before the write is awaited, so it cannot be lost.
    expect(result.current.progress).toBe(0);

    await act(async () => {
      await result.current.next();
    });
    expect(result.current.phase).toBe('question');
    expect(result.current.question?.id).toBe('q1');
    // The same question coming back counts as a new presentation, so the screen
    // knows to clear the draft it had.
    expect(result.current.presentation).toBeGreaterThan(0);

    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'a' });
    });
    expect(result.current.progress).toBe(1);

    await act(async () => {
      await result.current.next();
    });

    await waitFor(() => expect(result.current.phase).toBe('finished'));
    // Right on the second attempt does not count towards the score.
    expect(mockFinishLesson).toHaveBeenCalledWith(
      expect.objectContaining({ correct: 0, total: 1 })
    );
  });

  it('only ever re-queues a question once', async () => {
    const { result } = renderHook(() => useLessonSession(makeLocation([choice('q1')])));
    act(() => result.current.begin());

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        await result.current.submit({ type: 'multiple_choice', optionId: 'b' });
      });
      await act(async () => {
        await result.current.next();
      });
    }

    await waitFor(() => expect(result.current.phase).toBe('finished'));
    expect(mockSubmitAnswer).toHaveBeenCalledTimes(2);
  });

  it('takes a skipped question out of the score and out of the payout', async () => {
    const location = makeLocation([choice('q1'), choice('q2')]);
    const { result } = renderHook(() => useLessonSession(location));

    act(() => result.current.begin());
    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'a' });
    });
    await act(async () => {
      await result.current.next();
    });

    act(() => result.current.skip());

    await waitFor(() => expect(result.current.phase).toBe('finished'));
    // One answered, one skipped: a full score over the questions actually played,
    // and the skipped question's XP is not paid for.
    expect(mockFinishLesson).toHaveBeenCalledWith(
      expect.objectContaining({ correct: 1, total: 1, baseXp: 10 })
    );
  });

  it('counts the question on screen, not the one coming next', async () => {
    const location = makeLocation([choice('q1'), choice('q2'), choice('q3')]);
    const { result } = renderHook(() => useLessonSession(location));

    act(() => result.current.begin());
    expect(result.current.position).toBe(1);

    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'a' });
    });
    // Still on q1: the feedback for it is what the learner is reading.
    expect(result.current.phase).toBe('feedback');
    expect(result.current.position).toBe(1);

    await act(async () => {
      await result.current.next();
    });
    expect(result.current.position).toBe(2);

    // A miss does not stall the counter for the rest of the run either.
    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'b' });
    });
    await act(async () => {
      await result.current.next();
    });
    expect(result.current.question?.id).toBe('q3');
    expect(result.current.position).toBe(3);
  });

  it('renumbers around a skipped question', async () => {
    const location = makeLocation([choice('q1'), choice('q2'), choice('q3')]);
    const { result } = renderHook(() => useLessonSession(location));

    act(() => result.current.begin());
    act(() => result.current.skip());

    // q1 left the lesson, so q2 is the first of two.
    expect(result.current.question?.id).toBe('q2');
    expect(result.current.total).toBe(2);
    expect(result.current.position).toBe(1);
  });

  it('stops the lesson when the last heart is spent', async () => {
    mockSubmitAnswer.mockResolvedValue({ heartsLeft: 0, unlimitedHearts: false });

    const { result } = renderHook(() => useLessonSession(makeLocation([choice('q1')])));
    act(() => result.current.begin());

    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'b' });
    });

    await waitFor(() => expect(result.current.phase).toBe('out_of_hearts'));

    // Coming back shows the feedback that was on screen, not the question again.
    act(() => result.current.resume());
    expect(result.current.phase).toBe('feedback');
  });

  it('keeps playing when the answer cannot be written', async () => {
    mockSubmitAnswer.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useLessonSession(makeLocation([choice('q1')])));
    act(() => result.current.begin());

    await act(async () => {
      await result.current.submit({ type: 'multiple_choice', optionId: 'a' });
    });

    expect(result.current.phase).toBe('feedback');
    expect(result.current.lastResult?.isCorrect).toBe(true);
    expect(result.current.error).not.toBeNull();
  });
});
