/** PROBE (temporary): retention caps in the device document. */
import * as backend from '@/services/local/backend';
import { resetDocument } from '@/services/local/document';

const T0 = Date.parse('2026-08-19T09:00:00Z');

describe('retention', () => {
  it('mistakes deck forgets misses once the attempt log rolls over', async () => {
    await resetDocument();
    await backend.signIn();

    // The oldest miss the learner still owes.
    await backend.recordAnswer(
      { question: { id: 'owed', type: 'multiple_choice' }, lessonId: 'py-u01-l1', courseId: 'python', isCorrect: false },
      T0
    );
    expect(await backend.fetchMistakeQuestionIds('python')).toContain('owed');

    // Ordinary play afterwards: 700 correct answers.
    for (let i = 0; i < 700; i += 1) {
      await backend.recordAnswer(
        { question: { id: `ok-${i}`, type: 'multiple_choice' }, lessonId: 'py-u01-l1', courseId: 'python', isCorrect: true },
        T0 + (i + 1) * 60_000
      );
    }

    const still = await backend.fetchMistakeQuestionIds('python');
    console.log('mistakes after 700 later answers:', JSON.stringify(still));
    expect(still).toContain('owed'); // the server would still owe it
  }, 120_000);

  it('weekly XP survives a heavy week', async () => {
    await resetDocument();
    await backend.signIn();
    let expected = 0;
    for (let i = 0; i < 200; i += 1) {
      const res = await backend.recordPractice({ correct: 1, total: 1 }, T0 + Math.floor(i / 20) * 86_400_000);
      expected += res.xpAwarded;
    }
    // 10 days of practice at the cap; the last 7 days are what the league reads.
    const state = await backend.fetchGameState(T0 + 9 * 86_400_000);
    console.log('totalXp', state.totalXp, 'weeklyXp', state.weeklyXp, 'events kept?');
    expect(state.totalXp).toBe(expected);
  }, 120_000);
});
