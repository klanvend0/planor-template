/**
 * The rules two other implementations depend on.
 *
 * These are the SQL's rules restated in TypeScript, so each case here is
 * written against what `complete_lesson`, `settle_hearts`, `record_answer`,
 * `record_practice` and `refill_hearts` do — not against what the TypeScript
 * happens to do.
 */

import { MAX_HEARTS } from '@/lib/gamification';
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

const NOW = Date.parse('2026-08-19T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe('scoreFor', () => {
  it('is a percentage of the questions asked', () => {
    expect(scoreFor(6, 6)).toBe(100);
    expect(scoreFor(3, 6)).toBe(50);
    expect(scoreFor(0, 6)).toBe(0);
  });

  it('cannot be pushed past 100 or below 0', () => {
    expect(scoreFor(9, 6)).toBe(100);
    expect(scoreFor(-3, 6)).toBe(0);
    expect(scoreFor(1, 0)).toBe(100);
  });
});

describe('lessonAward', () => {
  it('pays the whole lesson the first time', () => {
    expect(lessonAward({ score: 100, bestBefore: 0, baseXp: 90 })).toEqual({
      award: 90,
      perfectBonus: 10,
    });
  });

  it('pays only the improvement on a replay', () => {
    expect(lessonAward({ score: 100, bestBefore: 50, baseXp: 90 })).toEqual({
      award: 45,
      perfectBonus: 10,
    });
  });

  it('rounds the way Postgres rounds, not the way doubles do', () => {
    // 150 * (57/100) is exactly 85.5 in decimal and 85.49999999999999 in
    // binary, so the naive expression pays one XP less than the server.
    expect(lessonAward({ score: 57, bestBefore: 0, baseXp: 150 })).toMatchObject({ award: 86 });
    expect(lessonAward({ score: 60, bestBefore: 25, baseXp: 90 })).toMatchObject({ award: 32 });
    expect(lessonAward({ score: 70, bestBefore: 0, baseXp: 45 })).toMatchObject({ award: 32 });
  });

  it('pays nothing for matching or falling short of the best run', () => {
    expect(lessonAward({ score: 100, bestBefore: 100, baseXp: 90 })).toEqual({
      award: 0,
      perfectBonus: 0,
    });
    expect(lessonAward({ score: 40, bestBefore: 80, baseXp: 90 })).toEqual({
      award: 0,
      perfectBonus: 0,
    });
  });
});

describe('streakAfter', () => {
  const base = { streakDays: 3, streakFreezes: 0 };

  it('starts at one for a learner who has never finished anything', () => {
    expect(
      streakAfter({ ...base, lastActiveDate: null, playedOn: '2026-08-19', streakDays: 0 })
    ).toMatchObject({ streakDays: 1, bonus: 0 });
  });

  it('extends on the following day and stands still on the same one', () => {
    expect(
      streakAfter({ ...base, lastActiveDate: '2026-08-18', playedOn: '2026-08-19' })
    ).toMatchObject({ streakDays: 4 });
    expect(
      streakAfter({ ...base, lastActiveDate: '2026-08-19', playedOn: '2026-08-19' })
    ).toMatchObject({ streakDays: 3 });
  });

  it('spends a freeze to survive one missed day, and resets without one', () => {
    expect(
      streakAfter({
        lastActiveDate: '2026-08-17',
        playedOn: '2026-08-19',
        streakDays: 9,
        streakFreezes: 1,
      })
    ).toMatchObject({ streakDays: 10, streakFreezes: 0 });

    expect(
      streakAfter({
        lastActiveDate: '2026-08-17',
        playedOn: '2026-08-19',
        streakDays: 9,
        streakFreezes: 0,
      })
    ).toMatchObject({ streakDays: 1, streakFreezes: 0 });
  });

  it('resets after two missed days even with a freeze in the bank', () => {
    expect(
      streakAfter({
        lastActiveDate: '2026-08-16',
        playedOn: '2026-08-19',
        streakDays: 9,
        streakFreezes: 2,
      })
    ).toMatchObject({ streakDays: 1, streakFreezes: 2 });
  });

  it('pays and banks on a seventh day, once', () => {
    const seventh = streakAfter({
      lastActiveDate: '2026-08-18',
      playedOn: '2026-08-19',
      streakDays: 6,
      streakFreezes: 0,
    });
    expect(seventh).toEqual({ streakDays: 7, streakFreezes: 1, bonus: 25 });

    // A second lesson the same day is on the same streak day.
    expect(
      streakAfter({
        lastActiveDate: '2026-08-19',
        playedOn: '2026-08-19',
        streakDays: 7,
        streakFreezes: 1,
      })
    ).toMatchObject({ bonus: 0 });
  });

  it('never banks more than two freezes', () => {
    expect(
      streakAfter({
        lastActiveDate: '2026-08-18',
        playedOn: '2026-08-19',
        streakDays: 13,
        streakFreezes: 2,
      })
    ).toMatchObject({ streakDays: 14, streakFreezes: 2, bonus: 25 });
  });
});

describe('hearts', () => {
  it('regenerates one per half hour, capped', () => {
    expect(settleHearts({ hearts: 2, heartsUpdatedAt: minutesAgo(70) }, NOW).hearts).toBe(4);
    expect(settleHearts({ hearts: 2, heartsUpdatedAt: minutesAgo(20) }, NOW).hearts).toBe(2);
    expect(settleHearts({ hearts: 4, heartsUpdatedAt: minutesAgo(600) }, NOW).hearts).toBe(
      MAX_HEARTS
    );
  });

  it('keeps the remainder of the current half hour, so watching it does not restart it', () => {
    const settled = settleHearts({ hearts: 1, heartsUpdatedAt: minutesAgo(50) }, NOW);
    expect(settled.hearts).toBe(2);
    // 30 of the 50 minutes were spent on the heart just granted; 20 carry over.
    expect(Date.parse(settled.heartsUpdatedAt)).toBe(NOW - 20 * 60_000);
  });

  it('spends one on a wrong answer, and nothing on a right one', () => {
    const full = { hearts: MAX_HEARTS, heartsUpdatedAt: minutesAgo(5) };
    expect(
      heartsAfterAnswer(full, { isCorrect: false, unlimited: false, isPractice: false }, NOW).hearts
    ).toBe(4);
    expect(
      heartsAfterAnswer(full, { isCorrect: true, unlimited: false, isPractice: false }, NOW).hearts
    ).toBe(MAX_HEARTS);
  });

  it('never spends one in practice or on a subscription', () => {
    const state = { hearts: 3, heartsUpdatedAt: minutesAgo(5) };
    expect(
      heartsAfterAnswer(state, { isCorrect: false, unlimited: false, isPractice: true }, NOW).hearts
    ).toBe(3);
    expect(
      heartsAfterAnswer(state, { isCorrect: false, unlimited: true, isPractice: false }, NOW).hearts
    ).toBe(3);
  });

  it('starts the regeneration clock when a full balance is broken', () => {
    const broken = heartsAfterAnswer(
      { hearts: MAX_HEARTS, heartsUpdatedAt: minutesAgo(900) },
      { isCorrect: false, unlimited: false, isPractice: false },
      NOW
    );
    expect(Date.parse(broken.heartsUpdatedAt)).toBe(NOW);
  });

  it('lets a free learner refill once a day', () => {
    expect(canRefillHearts(null, false, NOW)).toBe(true);
    expect(canRefillHearts(minutesAgo(60), false, NOW)).toBe(false);
    expect(canRefillHearts(minutesAgo(60 * 25), false, NOW)).toBe(true);
    // A subscriber is never held to the daily limit.
    expect(canRefillHearts(minutesAgo(60), true, NOW)).toBe(true);
  });
});

describe('practiceAward', () => {
  it('pays five per correct answer up to a daily cap', () => {
    expect(practiceAward(6, 0)).toBe(30);
    expect(practiceAward(6, 40)).toBe(10);
    expect(practiceAward(6, 50)).toBe(0);
    expect(practiceAward(0, 0)).toBe(0);
  });
});

describe('clampPlayedOn', () => {
  it('accepts the last two days and refuses anything older or in the future', () => {
    expect(clampPlayedOn('2026-08-18', '2026-08-19')).toBe('2026-08-18');
    expect(clampPlayedOn('2026-08-17', '2026-08-19')).toBe('2026-08-17');
    expect(clampPlayedOn('2026-08-01', '2026-08-19')).toBe('2026-08-17');
    expect(clampPlayedOn('2026-09-01', '2026-08-19')).toBe('2026-08-19');
    expect(clampPlayedOn(null, '2026-08-19')).toBe('2026-08-19');
  });
});

describe('toIsoDate', () => {
  it('is the UTC day, which is what the server dates events by', () => {
    expect(toIsoDate(Date.parse('2026-08-19T23:30:00Z'))).toBe('2026-08-19');
  });
});
