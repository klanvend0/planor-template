/**
 * PROBE (temporary): a literal transcription of the SQL RPCs, fuzzed against the
 * device backend. Deleted after the review.
 */
import { XP_BY_DIFFICULTY } from '@/lib/content_schema';
import { getLesson, getLessonBaseXp } from '@/services/content_service';
import * as backend from '@/services/local/backend';
import { resetDocument } from '@/services/local/document';

const DAY = 86_400_000;
const MIN = 60_000;

type Catalog = {
  lesson_id: string; unit_id: string; course_id: string;
  question_count: number; base_xp: number;
  premium_question_count: number; premium_xp: number;
};

function catalogFor(lessonId: string): Catalog {
  const lesson = getLesson(lessonId)!;
  const premium = lesson.questions.filter((q) => q.type === 'explain_code');
  return {
    lesson_id: lessonId,
    unit_id: '',
    course_id: '',
    question_count: lesson.questions.length,
    base_xp: getLessonBaseXp(lesson),
    premium_question_count: premium.length,
    premium_xp: premium.reduce((s, q) => s + XP_BY_DIFFICULTY[q.difficulty], 0),
  };
}

// --- date helpers, exactly as Postgres dates behave (UTC) ---
const d = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayNum = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY;
const fromDayNum = (n: number): string => d(n * DAY);
const addDays = (iso: string, n: number): string => fromDayNum(dayNum(iso) + n);

// round() half away from zero, on exact decimals
const pgRound = (n: number): number => Math.sign(n) * Math.round(Math.abs(n));

class Sql {
  game = {
    total_xp: 0, hearts: 5, hearts_updated_at: 0, streak_days: 0, longest_streak: 0,
    last_active_date: null as string | null, streak_freezes: 0,
    lessons_completed: 0, perfect_lessons: 0, last_free_refill_at: null as number | null,
  };
  progress = new Map<string, {
    lesson_id: string; course_id: string; unit_id: string; status: string;
    best_score: number; stars: number; attempts: number; xp_earned: number;
    first_completed_at: number | null;
  }>();
  attempts: { question_id: string; lesson_id: string; course_id: string; is_correct: boolean; attempt_id?: string; created_at: number }[] = [];
  xp: { amount: number; source: string; earned_on: string }[] = [];
  sub: { expires: number } | null = null;

  constructor(now: number) { this.game.hearts_updated_at = now; }

  private subscribed(now: number): boolean { return !!this.sub && this.sub.expires > now; }

  settleHearts(now: number): number {
    const g = this.game;
    if (g.hearts >= 5) { g.hearts_updated_at = now; return g.hearts; }
    const regen = Math.floor((now - g.hearts_updated_at) / 1800_000);
    if (regen > 0) {
      g.hearts = Math.min(5, g.hearts + regen);
      g.hearts_updated_at = g.hearts >= 5 ? now : g.hearts_updated_at + regen * 1800_000;
    }
    return g.hearts;
  }

  recordAnswer(p: { question_id: string; lesson_id: string; course_id: string; is_correct: boolean; practice?: boolean; attempt_id?: string }, now: number) {
    let recorded = 1;
    if (p.attempt_id && this.attempts.some((a) => a.attempt_id === p.attempt_id)) recorded = 0;
    else this.attempts.push({ ...p, created_at: now });

    const unlimited = this.subscribed(now);
    let hearts = this.settleHearts(now);

    if (recorded > 0 && !p.is_correct && !unlimited && !p.practice) {
      const g = this.game;
      const before = g.hearts;
      g.hearts = Math.max(0, g.hearts - 1);
      g.hearts_updated_at = before === 5 ? now : g.hearts_updated_at;
      hearts = g.hearts;
    }
    return { hearts_left: hearts, unlimited_hearts: unlimited };
  }

  completeLesson(p: { lesson_id: string; unit_id: string; course_id: string; correct: number; played_on?: string }, now: number) {
    if (p.correct == null || p.correct < 0) throw new Error('implausible answer count');
    const cat = catalogFor(p.lesson_id);
    let questions: number, baseXp: number;
    if (this.subscribed(now)) { questions = cat.question_count; baseXp = cat.base_xp; }
    else {
      questions = Math.max(1, cat.question_count - cat.premium_question_count);
      baseXp = Math.max(0, cat.base_xp - cat.premium_xp);
    }

    const score = pgRound((Math.min(p.correct, questions) / questions) * 100);
    const stars = score === 100 ? 3 : score >= 80 ? 2 : score >= 50 ? 1 : 0;

    const g = this.game;
    const prev = this.progress.get(p.lesson_id);
    const first = !prev || prev.status !== 'completed';
    const bestBefore = prev?.best_score ?? 0;

    let award = 0;
    if (score > bestBefore) {
      // exact decimal arithmetic: baseXp * (delta/100)
      const scaled = baseXp * (score - bestBefore);
      award = pgRound(scaled / 100);
      // emulate exact decimal: use integer remainder
      const whole = Math.floor(scaled / 100);
      award = scaled - whole * 100 >= 50 ? whole + 1 : whole;
    }
    const perfect = score === 100 && bestBefore < 100 ? 10 : 0;

    const excludedStatus = score >= 50 ? 'completed' : 'in_progress';
    if (!prev) {
      this.progress.set(p.lesson_id, {
        lesson_id: p.lesson_id, course_id: p.course_id, unit_id: p.unit_id,
        status: excludedStatus, best_score: score, stars, attempts: 1,
        xp_earned: award + perfect, first_completed_at: score >= 50 ? now : null,
      });
    } else {
      prev.status = score >= 50 || prev.status === 'completed' ? 'completed' : 'in_progress';
      prev.best_score = Math.max(prev.best_score, score);
      prev.stars = Math.max(prev.stars, stars);
      prev.attempts += 1;
      prev.xp_earned += award + perfect;
      prev.first_completed_at = prev.first_completed_at ?? (score >= 50 ? now : null);
    }

    const today = d(now);
    const played = fromDayNum(Math.max(Math.min(dayNum(p.played_on ?? today), dayNum(today)), dayNum(today) - 2));

    let streakDays = g.streak_days;
    let freezes = g.streak_freezes;
    const last = g.last_active_date;
    if (last === null) streakDays = 1;
    else if (dayNum(last) >= dayNum(played)) { /* nothing */ }
    else if (dayNum(last) === dayNum(played) - 1) streakDays += 1;
    else if (dayNum(last) === dayNum(played) - 2 && freezes > 0) { streakDays += 1; freezes -= 1; }
    else streakDays = 1;

    let streakBonus = 0;
    if (last !== played && streakDays > 0 && streakDays % 7 === 0) {
      streakBonus = 25;
      freezes = Math.min(2, freezes + 1);
    }

    g.total_xp += award + perfect + streakBonus;
    g.streak_days = streakDays;
    g.longest_streak = Math.max(g.longest_streak, streakDays);
    g.streak_freezes = freezes;
    g.last_active_date = last && dayNum(last) > dayNum(played) ? last : played;
    g.lessons_completed += first && score >= 50 ? 1 : 0;
    g.perfect_lessons += score === 100 && perfect > 0 ? 1 : 0;

    if (award > 0) this.xp.push({ amount: award, source: 'lesson', earned_on: played });
    if (perfect > 0) this.xp.push({ amount: perfect, source: 'perfect_bonus', earned_on: played });
    if (streakBonus > 0) this.xp.push({ amount: streakBonus, source: 'streak_bonus', earned_on: played });

    const daily = this.xp.filter((e) => e.earned_on === today).reduce((s, e) => s + e.amount, 0);

    return {
      totalXp: g.total_xp, xpAwarded: award + perfect + streakBonus, perfectBonus: perfect,
      streakBonus, streakDays: g.streak_days, hearts: g.hearts, stars, score,
      isFirstCompletion: first, dailyXp: daily,
    };
  }

  recordPractice(p: { correct: number; total: number }, now: number) {
    if (p.total <= 0 || p.correct < 0 || p.correct > p.total || p.total > 50) throw new Error('implausible practice payload');
    const today = d(now);
    const already = this.xp.filter((e) => e.source === 'practice' && e.earned_on === today).reduce((s, e) => s + e.amount, 0);
    const award = Math.max(0, Math.min(p.correct * 5, 50 - already));
    if (award > 0) { this.xp.push({ amount: award, source: 'practice', earned_on: today }); this.game.total_xp += award; }
    const daily = this.xp.filter((e) => e.earned_on === today).reduce((s, e) => s + e.amount, 0);
    return { xpAwarded: award, totalXp: this.game.total_xp, dailyXp: daily };
  }

  refillHearts(now: number) {
    const unlimited = this.subscribed(now);
    if (!unlimited && this.game.last_free_refill_at !== null && this.game.last_free_refill_at > now - 24 * 3600_000) {
      throw new Error('hearts can only be refilled once a day on the free plan');
    }
    this.game.hearts = 5;
    this.game.hearts_updated_at = now;
    if (!unlimited) this.game.last_free_refill_at = now;
    return 5;
  }

  gameState(now: number) {
    this.settleHearts(now);
    const today = d(now);
    const g = this.game;
    return {
      totalXp: g.total_xp, hearts: g.hearts, streakDays: g.streak_days,
      longestStreak: g.longest_streak, lastActiveDate: g.last_active_date,
      streakFreezes: g.streak_freezes, lessonsCompleted: g.lessons_completed,
      perfectLessons: g.perfect_lessons,
      dailyXp: this.xp.filter((e) => e.earned_on === today).reduce((s, e) => s + e.amount, 0),
      weeklyXp: this.xp.filter((e) => dayNum(e.earned_on) > dayNum(today) - 7).reduce((s, e) => s + e.amount, 0),
      hasSubscription: this.subscribed(now),
    };
  }

  mistakes(courseId: string, limit = 20): string[] {
    const rows = this.attempts.filter((a) =>
      a.course_id === courseId && !a.is_correct &&
      !this.attempts.some((l) => l.question_id === a.question_id && l.is_correct && l.created_at > a.created_at));
    const latest = new Map<string, number>();
    for (const r of rows) {
      const cur = latest.get(r.question_id);
      if (cur === undefined || r.created_at > cur) latest.set(r.question_id, r.created_at);
    }
    return [...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.min(limit, 50)).map(([q]) => q);
  }
}

// ---------------------------------------------------------------------------

const LESSONS = ['py-u01-l1', 'py-u01-l2', 'py-u02-l1'];
const T0 = Date.parse('2026-08-19T09:00:00Z');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe('parity fuzz', () => {
  it('device backend matches a literal transcription of the SQL', async () => {
    const mismatches: string[] = [];

    for (let seed = 1; seed <= 60; seed += 1) {
      await resetDocument();
      await backend.signIn();
      const r = rng(seed);
      const sql = new Sql(T0);
      let now = T0;

      for (let step = 0; step < 60; step += 1) {
        now += Math.floor(r() * 10 * 3600_000); // 0-10h jumps
        const pick = r();

        try {
          if (pick < 0.3) {
            const lesson = LESSONS[Math.floor(r() * LESSONS.length)];
            const correct = Math.floor(r() * 7);
            const backdate = r() < 0.2 ? d(now - Math.floor(r() * 5) * DAY) : undefined;
            const a = await backend.completeLesson({ lessonId: lesson, unitId: 'py-u01', courseId: 'python', correct, playedOn: backdate }, now);
            const b = sql.completeLesson({ lesson_id: lesson, unit_id: 'py-u01', course_id: 'python', correct, played_on: backdate }, now);
            if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(`seed${seed} step${step} completeLesson\n  ts : ${JSON.stringify(a)}\n  sql: ${JSON.stringify(b)}`);
          } else if (pick < 0.6) {
            const qid = `q${Math.floor(r() * 5)}`;
            const ok = r() < 0.5;
            const practice = r() < 0.25;
            const attemptId = r() < 0.3 ? `att${Math.floor(r() * 4)}` : undefined;
            const a = await backend.recordAnswer({ question: { id: qid, type: 'multiple_choice' }, lessonId: LESSONS[0], courseId: 'python', isCorrect: ok, isPractice: practice, attemptId }, now);
            const b = sql.recordAnswer({ question_id: qid, lesson_id: LESSONS[0], course_id: 'python', is_correct: ok, practice, attempt_id: attemptId }, now);
            if (a.heartsLeft !== b.hearts_left || a.unlimitedHearts !== b.unlimited_hearts) mismatches.push(`seed${seed} step${step} recordAnswer ts=${JSON.stringify(a)} sql=${JSON.stringify(b)}`);
          } else if (pick < 0.72) {
            const correct = Math.floor(r() * 8);
            const total = Math.max(correct, 1 + Math.floor(r() * 10));
            const a = await backend.recordPractice({ correct, total }, now);
            const b = sql.recordPractice({ correct, total }, now);
            if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(`seed${seed} step${step} practice ts=${JSON.stringify(a)} sql=${JSON.stringify(b)}`);
          } else if (pick < 0.8) {
            let tsErr = false, sqlErr = false, av = 0, bv = 0;
            try { av = await backend.refillHearts(now); } catch { tsErr = true; }
            try { bv = sql.refillHearts(now); } catch { sqlErr = true; }
            if (tsErr !== sqlErr || av !== bv) mismatches.push(`seed${seed} step${step} refill ts=${tsErr ? 'err' : av} sql=${sqlErr ? 'err' : bv}`);
          } else if (pick < 0.85) {
            const expires = now + Math.floor(r() * 5) * DAY;
            await backend.grantSubscription({ productId: 'p', expiresAt: new Date(expires).toISOString(), isTrial: false, willRenew: true });
            sql.sub = { expires };
          } else if (pick < 0.93) {
            const a = await backend.fetchMistakeQuestionIds('python', 20);
            const b = sql.mistakes('python', 20);
            if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(`seed${seed} step${step} mistakes ts=${JSON.stringify(a)} sql=${JSON.stringify(b)}`);
          } else {
            const a = await backend.fetchGameState(now);
            const b = sql.gameState(now);
            for (const k of Object.keys(b) as (keyof typeof b)[]) {
              if ((a as any)[k] !== (b as any)[k]) mismatches.push(`seed${seed} step${step} gameState.${k} ts=${(a as any)[k]} sql=${(b as any)[k]}`);
            }
          }
        } catch (error) {
          mismatches.push(`seed${seed} step${step} threw ${(error as Error).message}`);
        }
      }

      // lesson_progress rows
      const rows = await backend.fetchLessonProgress('python');
      for (const row of rows) {
        const sqlRow = sql.progress.get(row.lessonId)!;
        const ts = { status: row.status, bestScore: row.bestScore, stars: row.stars, attempts: row.attempts, xpEarned: row.xpEarned, cleared: row.firstCompletedAt !== null };
        const pg = { status: sqlRow.status, bestScore: sqlRow.best_score, stars: sqlRow.stars, attempts: sqlRow.attempts, xpEarned: sqlRow.xp_earned, cleared: sqlRow.first_completed_at !== null };
        if (JSON.stringify(ts) !== JSON.stringify(pg)) mismatches.push(`seed${seed} progress ${row.lessonId}\n  ts : ${JSON.stringify(ts)}\n  sql: ${JSON.stringify(pg)}`);
      }
      if (rows.length !== sql.progress.size) mismatches.push(`seed${seed} progress row count ts=${rows.length} sql=${sql.progress.size}`);

      // final full comparison
      const a = await backend.fetchGameState(now);
      const b = sql.gameState(now);
      for (const k of Object.keys(b) as (keyof typeof b)[]) {
        if ((a as any)[k] !== (b as any)[k]) mismatches.push(`seed${seed} FINAL gameState.${k} ts=${(a as any)[k]} sql=${(b as any)[k]}`);
      }
    }

    if (mismatches.length) {
      const uniq = [...new Set(mismatches.map((m) => m.replace(/seed\d+ step\d+ /, '').replace(/seed\d+ FINAL /, 'FINAL ')))];
      console.log(`MISMATCHES ${mismatches.length}, unique shapes ${uniq.length}`);
      console.log(uniq.slice(0, 25).join('\n'));
    }
    expect(mismatches.length).toBe(0);
  }, 120_000);
});
