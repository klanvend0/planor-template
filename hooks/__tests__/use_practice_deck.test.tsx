/**
 * What a practice run is made of.
 *
 * Both decks filter out the AI-graded question — it costs a real API call, and
 * practice is meant to be free-flowing — and both are capped at the session
 * size. Quick review is also deterministic per day, so a deck cannot reshuffle
 * under the learner's thumb between two taps.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { PRACTICE_SESSION_SIZE } from '@/lib/constants';
import type { Question } from '@/lib/content_schema';
import { useMistakesDeck, useQuickReviewDeck } from '@/hooks/use_practice_deck';

const mockFetchMistakeQuestionIds = jest.fn();
const mockGetQuestion = jest.fn();
const mockGetCourseLessons = jest.fn();

jest.mock('@/services/progress_service', () => ({
  fetchMistakeQuestionIds: (...args: unknown[]) => mockFetchMistakeQuestionIds(...args),
}));

jest.mock('@/services/content_service', () => ({
  getQuestion: (...args: unknown[]) => mockGetQuestion(...args),
  getCourseLessons: (...args: unknown[]) => mockGetCourseLessons(...args),
}));

// One state object for the whole file: the real store hands back the same
// reference until something changes, and a fresh one per render would make the
// hook rebuild its deck forever.
const mockProgressState = { byLesson: {} };

jest.mock('@/stores/progress_store', () => ({
  useProgressStore: (selector: (state: unknown) => unknown) => selector(mockProgressState),
  isLessonCompleted: (_byLesson: unknown, lessonId: string) => lessonId !== 'unfinished',
}));

const localized = (value: string) => ({ en: value, tr: value });

function question(id: string, type: Question['type'] = 'multiple_choice'): Question {
  return {
    id,
    type,
    difficulty: 'easy',
    prompt: localized('Pick one'),
    explanation: localized('Because.'),
    options: [
      { id: 'a', text: localized('right') },
      { id: 'b', text: localized('wrong') },
    ],
    answerId: 'a',
  } as Question;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetQuestion.mockImplementation((id: string) => question(id));
});

describe('the mistakes deck', () => {
  it('asks for more than it needs, then plays a session of what is left', async () => {
    const missed = Array.from({ length: PRACTICE_SESSION_SIZE * 2 }, (_, index) => `q${index}`);
    mockFetchMistakeQuestionIds.mockResolvedValue(missed);

    const { result } = renderHook(() => useMistakesDeck('python'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Twice the session size, because the filters below can drop some of them.
    expect(mockFetchMistakeQuestionIds).toHaveBeenCalledWith('python', PRACTICE_SESSION_SIZE * 2);
    expect(result.current.questions).toHaveLength(PRACTICE_SESSION_SIZE);
    expect(result.current.questions.map((entry) => entry.id)).toEqual(
      missed.slice(0, PRACTICE_SESSION_SIZE)
    );
  });

  it('leaves out the paid question and anything no longer in the content', async () => {
    mockFetchMistakeQuestionIds.mockResolvedValue(['kept', 'paid', 'retired']);
    mockGetQuestion.mockImplementation((id: string) => {
      if (id === 'retired') return null;
      return question(id, id === 'paid' ? 'explain_code' : 'multiple_choice');
    });

    const { result } = renderHook(() => useMistakesDeck('python'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.questions.map((entry) => entry.id)).toEqual(['kept']);
  });

  it('reports a failure and plays nothing rather than a stale deck', async () => {
    mockFetchMistakeQuestionIds.mockResolvedValue(['kept']);
    const { result } = renderHook(() => useMistakesDeck('python'));
    await waitFor(() => expect(result.current.questions).toHaveLength(1));

    mockFetchMistakeQuestionIds.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.questions).toEqual([]);
  });
});

describe('quick review', () => {
  const lessons = [
    {
      lesson: {
        id: 'py-u01-l1',
        questions: [question('a'), question('b'), question('paid', 'explain_code')],
      },
    },
    { lesson: { id: 'unfinished', questions: [question('locked')] } },
  ];

  it('draws only on lessons already finished, and never the paid question', () => {
    mockGetCourseLessons.mockReturnValue(lessons);

    const { result } = renderHook(() => useQuickReviewDeck('python'));

    expect(result.current.questions.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
    expect(result.current.isLoading).toBe(false);
  });

  it('deals the same deck twice in one day', () => {
    const many = Array.from({ length: 30 }, (_, index) => question(`q${index}`));
    mockGetCourseLessons.mockReturnValue([{ lesson: { id: 'py-u01-l1', questions: many } }]);

    const first = renderHook(() => useQuickReviewDeck('python'));
    const second = renderHook(() => useQuickReviewDeck('python'));

    expect(first.result.current.questions).toHaveLength(PRACTICE_SESSION_SIZE);
    expect(first.result.current.questions.map((entry) => entry.id)).toEqual(
      second.result.current.questions.map((entry) => entry.id)
    );
  });
});
