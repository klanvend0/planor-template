/**
 * The reward curve decides how the whole game feels, so it is pinned by tests.
 */

import {
  ACHIEVEMENTS,
  formatCountdown,
  isUnlocked,
  leagueFromWeeklyXp,
  levelFromXp,
  msUntilNextHeart,
  starsForScore,
  xpForNextLevel,
  xpToReachLevel,
  type AchievementStats,
} from '@/lib/gamification';

describe('levels', () => {
  it('starts everyone at level 1', () => {
    const info = levelFromXp(0);
    expect(info.level).toBe(1);
    expect(info.xpIntoLevel).toBe(0);
    expect(info.progress).toBe(0);
  });

  it('levels up exactly at the threshold', () => {
    expect(levelFromXp(xpForNextLevel(1) - 1).level).toBe(1);
    expect(levelFromXp(xpForNextLevel(1)).level).toBe(2);
  });

  it('keeps xpToReachLevel and levelFromXp consistent', () => {
    for (let level = 1; level <= 12; level += 1) {
      const required = xpToReachLevel(level);
      expect(levelFromXp(required).level).toBe(level);
      expect(levelFromXp(required).xpIntoLevel).toBe(0);
    }
  });

  it('gets progressively harder', () => {
    expect(xpForNextLevel(2)).toBeGreaterThan(xpForNextLevel(1));
    expect(xpForNextLevel(10)).toBeGreaterThan(xpForNextLevel(9));
  });

  it('never breaks on nonsense input', () => {
    expect(levelFromXp(-500).level).toBe(1);
  });
});

describe('leagues', () => {
  it('places a new learner in bronze', () => {
    expect(leagueFromWeeklyXp(0).league).toBe('bronze');
  });

  it('promotes at each threshold', () => {
    expect(leagueFromWeeklyXp(150).league).toBe('silver');
    expect(leagueFromWeeklyXp(399).league).toBe('silver');
    expect(leagueFromWeeklyXp(400).league).toBe('gold');
    expect(leagueFromWeeklyXp(2500).league).toBe('diamond');
    expect(leagueFromWeeklyXp(99_999).league).toBe('diamond');
  });

  it('reports the distance to the next league', () => {
    const info = leagueFromWeeklyXp(100);
    expect(info.next).toBe('silver');
    expect(info.xpToNext).toBe(50);
    expect(info.progress).toBeGreaterThan(0.6);
  });

  it('tops out cleanly', () => {
    const info = leagueFromWeeklyXp(5000);
    expect(info.next).toBeNull();
    expect(info.xpToNext).toBe(0);
    expect(info.progress).toBe(1);
  });
});

describe('stars', () => {
  it('mirrors the thresholds the database uses', () => {
    expect(starsForScore(100)).toBe(3);
    expect(starsForScore(80)).toBe(2);
    expect(starsForScore(79)).toBe(1);
    expect(starsForScore(50)).toBe(1);
    expect(starsForScore(49)).toBe(0);
  });
});

describe('hearts', () => {
  const now = new Date('2026-08-18T12:00:00Z');

  it('does not count down when hearts are full', () => {
    expect(msUntilNextHeart(5, now.toISOString(), now)).toBe(0);
  });

  it('counts down from the last change', () => {
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    expect(msUntilNextHeart(2, tenMinutesAgo, now)).toBe(20 * 60 * 1000);
  });

  it('rolls over past regeneration periods', () => {
    const fortyMinutesAgo = new Date(now.getTime() - 40 * 60 * 1000).toISOString();
    expect(msUntilNextHeart(2, fortyMinutesAgo, now)).toBe(20 * 60 * 1000);
  });

  it('formats the countdown for the hearts sheet', () => {
    expect(formatCountdown(20 * 60 * 1000)).toBe('20:00');
    expect(formatCountdown(65 * 1000)).toBe('1:05');
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('achievements', () => {
  const emptyStats: AchievementStats = {
    totalXp: 0,
    streakDays: 0,
    longestStreak: 0,
    lessonsCompleted: 0,
    perfectLessons: 0,
    aiReviewsPassed: 0,
    coursesStarted: 1,
    unitsCompleted: 0,
  };

  it('starts fully locked', () => {
    expect(ACHIEVEMENTS.every((achievement) => !isUnlocked(achievement, emptyStats))).toBe(true);
  });

  it('unlocks the first lesson badge on the first lesson', () => {
    const stats = { ...emptyStats, lessonsCompleted: 1 };
    const first = ACHIEVEMENTS.find((achievement) => achievement.id === 'first_lesson')!;
    expect(isUnlocked(first, stats)).toBe(true);
  });

  it('reports partial progress rather than jumping to unlocked', () => {
    const stats = { ...emptyStats, longestStreak: 3 };
    const week = ACHIEVEMENTS.find((achievement) => achievement.id === 'streak_7')!;
    expect(week.progress(stats)).toBeCloseTo(3 / 7);
    expect(isUnlocked(week, stats)).toBe(false);
  });

  it('has a unique id and copy for every badge', () => {
    const ids = ACHIEVEMENTS.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ACHIEVEMENTS.every((achievement) => achievement.titleKey && achievement.bodyKey)).toBe(true);
  });
});
