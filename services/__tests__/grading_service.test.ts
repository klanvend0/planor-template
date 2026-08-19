/**
 * How the app reads the grader's answers — and its refusals.
 *
 * The screen decides what to say from the error's code, so a mapping that
 * drifts shows "Something went wrong" to a learner whose subscription lapsed or
 * whose explanation was two characters short. Everything below is about that
 * translation, plus the shape the review comes back in.
 */

import { AppError } from '@/lib/errors';

const mockInvoke = jest.fn();

jest.mock('@/lib/backend_mode', () => ({ USES_LOCAL_BACKEND: false }));
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

// The real class, so `instanceof` still decides which branch runs.
const { FunctionsHttpError } = jest.requireActual('@supabase/supabase-js');

/** An edge function error, as supabase-js hands it over. */
function httpError(status: number, body: unknown): Error {
  return new FunctionsHttpError({
    status,
    json: async () => {
      if (body === undefined) throw new Error('not json');
      return body;
    },
  });
}

import { gradeExplanation } from '@/services/grading_service';

beforeEach(() => {
  mockInvoke.mockReset();
});

const request = { questionId: 'py-u01-l1-q6', answer: 'a'.repeat(120), locale: 'en' as const };

describe('a graded explanation', () => {
  it('sends the question, the answer and the language to answer in', async () => {
    mockInvoke.mockResolvedValue({
      data: { verdict: 'correct', score: 91, summary: 'Good', corrections: [], missedPoints: [] },
      error: null,
    });

    const review = await gradeExplanation(request);

    expect(mockInvoke).toHaveBeenCalledWith('grade-explanation', {
      body: { questionId: request.questionId, answer: request.answer, locale: 'en' },
    });
    expect(review).toEqual({
      verdict: 'correct',
      score: 91,
      summary: 'Good',
      corrections: [],
      missedPoints: [],
    });
  });

  it('fills in what a terse grader leaves out, and keeps the score in range', async () => {
    mockInvoke.mockResolvedValue({ data: { verdict: 'partial', score: 140.6 }, error: null });

    const review = await gradeExplanation(request);

    expect(review).toEqual({
      verdict: 'partial',
      score: 100,
      summary: '',
      corrections: [],
      missedPoints: [],
    });
  });

  it('refuses a result with no verdict rather than showing an empty mark', async () => {
    mockInvoke.mockResolvedValue({ data: { score: 80 }, error: null });
    await expect(gradeExplanation(request)).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('when the grader refuses', () => {
  it.each([
    [402, { error: 'subscription_required' }, 'subscription_required'],
    [200, { error: 'subscription_required' }, 'subscription_required'],
    [429, { error: 'rate_limited' }, 'rate_limited'],
    [401, { error: 'unauthorized' }, 'auth'],
    [400, { error: 'answer_too_short' }, 'answer_too_short'],
    [500, { error: 'provider_failed' }, 'unknown'],
  ])('turns %i %o into %s', async (status, body, code) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, body) });
    await expect(gradeExplanation(request)).rejects.toMatchObject({ code });
  });

  it('falls back to the status when the body is not JSON', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(402, undefined) });
    await expect(gradeExplanation(request)).rejects.toMatchObject({
      code: 'subscription_required',
    });
  });

  it('calls a transport failure what it is, so the screen can offer a retry', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });

    const failure = await gradeExplanation(request).catch((error: AppError) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: 'network' });
  });
});
