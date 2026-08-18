/**
 * The offline queue decides whether a lesson played on a plane is remembered or
 * lost, and whether a stuck payload blocks every write behind it — so its replay
 * semantics are pinned here.
 */

import { AppError } from '@/lib/errors';
import { useSyncQueue } from '@/stores/sync_queue';

jest.mock('@/services/progress_service', () => ({
  recordAnswer: jest.fn(),
  completeLesson: jest.fn(),
}));

import { completeLesson, recordAnswer } from '@/services/progress_service';

const recordAnswerMock = recordAnswer as jest.MockedFunction<typeof recordAnswer>;
const completeLessonMock = completeLesson as jest.MockedFunction<typeof completeLesson>;

const answer = (questionId: string) => ({
  kind: 'answer' as const,
  payload: {
    questionId,
    questionType: 'multiple_choice' as const,
    lessonId: 'py-u01-l1',
    courseId: 'python' as const,
    isCorrect: true,
  },
});

const lesson = () => ({
  kind: 'lesson' as const,
  payload: {
    lessonId: 'py-u01-l1',
    unitId: 'py-u01',
    courseId: 'python' as const,
    correct: 6,
    total: 6,
    baseXp: 90,
  },
});

beforeEach(() => {
  useSyncQueue.setState({ entries: [], flushing: false, ownerId: 'learner-1' });
  recordAnswerMock.mockReset();
  completeLessonMock.mockReset();
  recordAnswerMock.mockResolvedValue({ heartsLeft: 5, unlimitedHearts: false });
  completeLessonMock.mockResolvedValue({
    totalXp: 90,
    xpAwarded: 90,
    streakDays: 1,
    hearts: 5,
    stars: 3,
    score: 100,
    isFirstCompletion: true,
    dailyXp: 90,
  });
});

describe('sync queue', () => {
  it('replays writes oldest first and empties', async () => {
    const { enqueue, flush } = useSyncQueue.getState();
    enqueue(answer('q1'));
    enqueue(answer('q2'));
    enqueue(lesson());

    const replayed = await flush();

    expect(replayed).toBe(3);
    expect(useSyncQueue.getState().entries).toHaveLength(0);
    expect(recordAnswerMock.mock.calls.map((call) => call[0].question.id)).toEqual(['q1', 'q2']);
    expect(completeLessonMock).toHaveBeenCalledTimes(1);
  });

  it('keeps everything when the network is still down', async () => {
    recordAnswerMock.mockRejectedValue(new AppError('network', 'offline'));

    const { enqueue, flush } = useSyncQueue.getState();
    enqueue(answer('q1'));
    enqueue(answer('q2'));

    expect(await flush()).toBe(0);
    expect(useSyncQueue.getState().entries).toHaveLength(2);
  });

  it('stops at the first network failure rather than reordering', async () => {
    recordAnswerMock
      .mockResolvedValueOnce({ heartsLeft: 5, unlimitedHearts: false })
      .mockRejectedValueOnce(new AppError('network', 'offline'));

    const { enqueue, flush } = useSyncQueue.getState();
    enqueue(answer('q1'));
    enqueue(answer('q2'));
    enqueue(lesson());

    expect(await flush()).toBe(1);
    // q2 and the lesson stay, in order, for the next attempt.
    expect(useSyncQueue.getState().entries.map((entry) => entry.kind)).toEqual([
      'answer',
      'lesson',
    ]);
    expect(completeLessonMock).not.toHaveBeenCalled();
  });

  it('drops a payload the server refuses, so it cannot block the queue', async () => {
    recordAnswerMock
      .mockRejectedValueOnce(new AppError('unknown', 'invalid payload'))
      .mockResolvedValueOnce({ heartsLeft: 5, unlimitedHearts: false });

    const { enqueue, flush } = useSyncQueue.getState();
    enqueue(answer('bad'));
    enqueue(answer('good'));

    await flush();

    expect(useSyncQueue.getState().entries).toHaveLength(0);
    expect(recordAnswerMock).toHaveBeenCalledTimes(2);
  });

  it('holds everything back while signed out', async () => {
    recordAnswerMock.mockRejectedValue(new AppError('auth', 'no session'));

    const { enqueue, flush } = useSyncQueue.getState();
    enqueue(answer('q1'));

    expect(await flush()).toBe(0);
    expect(useSyncQueue.getState().entries).toHaveLength(1);
  });

  it('is a no-op when nothing is queued', async () => {
    expect(await useSyncQueue.getState().flush()).toBe(0);
    expect(recordAnswerMock).not.toHaveBeenCalled();
  });

  it('drops the backlog when a different learner signs in', () => {
    const { enqueue, setOwner } = useSyncQueue.getState();
    enqueue(answer('q1'));
    expect(useSyncQueue.getState().entries).toHaveLength(1);

    setOwner('learner-2');
    expect(useSyncQueue.getState().entries).toHaveLength(0);
    expect(useSyncQueue.getState().ownerId).toBe('learner-2');
  });

  it('sends nothing while signed out', async () => {
    const { enqueue } = useSyncQueue.getState();
    enqueue(answer('q1'));
    useSyncQueue.setState({ ownerId: null });

    expect(await useSyncQueue.getState().flush()).toBe(0);
    expect(recordAnswerMock).not.toHaveBeenCalled();
  });

  it('refuses to replay a write stamped with another learner', async () => {
    useSyncQueue.setState({
      ownerId: 'learner-2',
      entries: [
        {
          id: 'a',
          kind: 'answer',
          queuedAt: 1,
          userId: 'learner-1',
          payload: answer('q1').payload,
        },
      ],
    });

    expect(await useSyncQueue.getState().flush()).toBe(0);
    expect(recordAnswerMock).not.toHaveBeenCalled();
    expect(useSyncQueue.getState().entries).toHaveLength(0);
  });

  it('caps the backlog instead of growing without bound', () => {
    const { enqueue } = useSyncQueue.getState();
    for (let index = 0; index < 250; index += 1) enqueue(answer(`q${index}`));

    const entries = useSyncQueue.getState().entries;
    expect(entries).toHaveLength(200);
    // The oldest are dropped first, so the most recent play survives.
    expect(
      (entries[entries.length - 1] as { payload: { questionId: string } }).payload.questionId
    ).toBe('q249');
  });
});
