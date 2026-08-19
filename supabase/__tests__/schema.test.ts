/**
 * The schema, run against a real PostgreSQL.
 *
 * `lib/scoring.ts` claims to state the same rules the SQL does, and nothing but
 * a live database can check that claim: PL/pgSQL is compiled at call time, so a
 * function that fails on every invocation still installs cleanly. Two such bugs
 * (an OUT column shadowing a table column in `record_practice` and in
 * `complete_lesson`) survived every review and typecheck, and would have broken
 * lesson completion for every learner on a real project.
 *
 * The suite is skipped unless `SCHEMA_TEST_DSN` names a database it may create
 * and drop objects in — `npm run db:check` starts a throwaway cluster and sets
 * it. `npm test` on its own is unaffected.
 *
 * @module supabase/__tests__/schema
 */

import { execFileSync } from 'node:child_process';

import {
  lessonAward,
  practiceAward,
  scoreFor,
  settleHearts,
  PRACTICE_DAILY_XP_CAP,
} from '@/lib/scoring';

const DSN = process.env.SCHEMA_TEST_DSN;
const LEARNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '99999999-9999-9999-9999-999999999999';

/** Run SQL as one learner, optionally under a database role (for RLS). */
function query(text: string, options: { role?: string; user?: string } = {}): string[][] {
  const user = options.user ?? LEARNER;
  const prelude = options.role
    ? `set role ${options.role}; select set_config('request.jwt.claim.sub', '${user}', false);`
    : `select set_config('request.jwt.claim.sub', '${user}', false);`;

  const out = execFileSync(
    'psql',
    [DSN!, '-tAF', '\t', '-v', 'ON_ERROR_STOP=1', '-c', prelude + text],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  // Drop the prelude's own output: the set_config value, preceded by psql's
  // "SET" when a role was switched.
  return out
    .trim()
    .split('\n')
    .slice(options.role ? 2 : 1)
    .filter((line) => line !== '')
    .map((line) => line.split('\t'));
}

/** Like {@link query}, but for statements expected to be refused. */
function refused(text: string, options: { role?: string; user?: string } = {}): boolean {
  try {
    query(text, options);
    return false;
  } catch {
    return true;
  }
}

const number = (value: string) => (value === '' ? null : Number(value));

function freshLearners(): void {
  execFileSync('psql', [DSN!, '-q', '-v', 'ON_ERROR_STOP=1', '-c', 'delete from auth.users;'], {
    stdio: 'ignore',
  });
  execFileSync(
    'psql',
    [
      DSN!,
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `insert into auth.users (id, email, raw_user_meta_data) values
         ('${LEARNER}', 'learner@example.com', '{"name":"Learner"}'::jsonb),
         ('${OTHER}', 'other@example.com', '{"name":"Other"}'::jsonb);`,
    ],
    { stdio: 'ignore' }
  );
}

const suite = DSN ? describe : describe.skip;

suite('the schema on a real database', () => {
  /** The lesson the RPCs are exercised against, as the catalog sees it. */
  let questions = 0;
  let baseXp = 0;

  beforeAll(() => {
    const [[questionCount, catalogXp, premiumCount, premiumXp]] = query(
      `select question_count, base_xp, premium_question_count, premium_xp
         from public.lesson_catalog where lesson_id = 'py-u01-l1';`
    ).map((row) => row.map(number));

    // A free learner is scored over the questions they are shown, and paid for
    // that share of the lesson.
    questions = Math.max(1, (questionCount ?? 1) - (premiumCount ?? 0));
    baseXp = Math.max(0, (catalogXp ?? 0) - (premiumXp ?? 0));
  });

  beforeEach(freshLearners);

  function completeLesson(correct: number, playedOn?: string) {
    const [row] = query(
      `select * from public.complete_lesson('py-u01-l1','py-u01','python',${correct},${questions},${baseXp},${
        playedOn ? `'${playedOn}'::date` : 'null'
      });`
    );
    return {
      totalXp: number(row[0]),
      xpAwarded: number(row[1]),
      perfectBonus: number(row[2]),
      streakBonus: number(row[3]),
      streakDays: number(row[4]),
      hearts: number(row[5]),
      stars: number(row[6]),
      score: number(row[7]),
      isFirstCompletion: row[8] === 't',
      dailyXp: number(row[9]),
    };
  }

  function answer(question: string, correct: boolean, attemptId?: string, practice = false) {
    return query(
      `select * from public.record_answer('${question}','py-u01-l1','python','multiple_choice',${correct},'x',1200,${practice},${
        attemptId ? `'${attemptId}'::uuid` : 'null'
      });`
    )[0];
  }

  it('pays a lesson exactly what lib/scoring.ts says it does', () => {
    const partial = completeLesson(3);
    const expected = lessonAward({ baseXp, score: scoreFor(3, questions), bestBefore: 0 });
    expect(partial.xpAwarded).toBe(expected.award + expected.perfectBonus);
    expect(partial.score).toBe(scoreFor(3, questions));

    // A better run pays for the improvement only.
    const perfect = completeLesson(questions);
    const better = lessonAward({ baseXp, score: 100, bestBefore: partial.score! });
    expect(perfect.xpAwarded).toBe(better.award + better.perfectBonus);
    expect(perfect.perfectBonus).toBe(10);
    expect(perfect.stars).toBe(3);

    // And a replay pays nothing at all.
    expect(completeLesson(questions).xpAwarded).toBe(0);
  });

  it('keeps the best of every attempt', () => {
    completeLesson(questions);
    completeLesson(1);
    const [[best, stars, attempts, status]] = query(
      `select best_score, stars, attempts, status from public.lesson_progress where lesson_id = 'py-u01-l1';`
    );
    expect([number(best), number(stars), number(attempts), status]).toEqual([
      100,
      3,
      2,
      'completed',
    ]);
  });

  it('advances the streak by the day a lesson was played, not the day it arrived', () => {
    const [[today]] = query(`select (now() at time zone 'utc')::date;`);
    const day = (offset: number) => {
      const date = new Date(`${today}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };

    expect(completeLesson(questions, day(-1)).streakDays).toBe(1);
    expect(completeLesson(questions - 1, day(0)).streakDays).toBe(2);
    // A second lesson the same day is still one day...
    expect(completeLesson(1, day(0)).streakDays).toBe(2);
    // ...and a date older than the clamp cannot rewrite history.
    expect(completeLesson(questions, day(-9)).streakDays).toBe(2);
  });

  it('charges one heart per miss, and never twice for the same attempt', () => {
    expect(answer('q1', false, '10000000-0000-0000-0000-000000000001')).toEqual(['4', 'f']);
    // The offline queue is at-least-once; a replay must be free.
    expect(answer('q1', false, '10000000-0000-0000-0000-000000000001')).toEqual(['4', 'f']);
    expect(answer('q2', true, '10000000-0000-0000-0000-000000000002')).toEqual(['4', 'f']);
    // Practice is a warm-up over questions already met.
    expect(answer('q3', false, '10000000-0000-0000-0000-000000000003', true)).toEqual(['4', 'f']);
  });

  it('regenerates hearts on the same clock as the client', () => {
    query(
      `update public.game_state set hearts = 0, hearts_updated_at = now() - interval '95 minutes'
         where user_id = '${LEARNER}';`
    );
    const [[hearts]] = query(`select public.settle_hearts('${LEARNER}');`);
    const local = settleHearts(
      { hearts: 0, heartsUpdatedAt: new Date(Date.now() - 95 * 60_000).toISOString() },
      Date.now()
    );
    expect(number(hearts)).toBe(local.hearts);
  });

  it('refills once a day on the free plan, and always for a subscriber', () => {
    query(`update public.game_state set hearts = 0 where user_id = '${LEARNER}';`);
    expect(number(query(`select public.refill_hearts();`)[0][0])).toBe(5);

    query(`update public.game_state set hearts = 1 where user_id = '${LEARNER}';`);
    expect(refused(`select public.refill_hearts();`)).toBe(true);

    query(
      `insert into public.subscriptions (user_id, rc_app_user_id, entitlement, status, current_period_end)
         values ('${LEARNER}','${LEARNER}','pro','active', now() + interval '30 days')
         on conflict (user_id) do update set status = 'active';`
    );
    query(`update public.game_state set hearts = 2 where user_id = '${LEARNER}';`);
    expect(number(query(`select public.refill_hearts();`)[0][0])).toBe(5);
    // ...who is never charged for a miss either.
    expect(answer('q4', false)).toEqual(['5', 't']);
  });

  it('pays practice by the same rule as the client, and only once per run', () => {
    const run = '22222222-2222-2222-2222-222222222222';
    const first = query(`select * from public.record_practice('python', 4, 4, '${run}');`)[0];
    expect(number(first[0])).toBe(practiceAward(4, 0));

    // The results screen can retry a finish whose response was lost.
    const retry = query(`select * from public.record_practice('python', 4, 4, '${run}');`)[0];
    expect(retry).toEqual(first);
    expect(
      number(query(`select count(*) from public.xp_events where run_id = '${run}';`)[0][0])
    ).toBe(1);

    // A different run still pays, up to the daily cap.
    query(
      `select * from public.record_practice('python', 10, 10, '33333333-3333-3333-3333-333333333333');`
    );
    const capped = query(
      `select * from public.record_practice('python', 10, 10, '44444444-4444-4444-4444-444444444444');`
    )[0];
    expect(number(capped[0])).toBe(0);
    expect(number(capped[2])).toBe(PRACTICE_DAILY_XP_CAP);
  });

  it('holds a question in the mistakes deck until it is answered right', () => {
    answer('q-old', false);
    answer('q-new', false);
    answer('q-fixed', false);
    answer('q-fixed', true);

    const deck = query(`select question_id from public.get_mistake_questions('python', 20);`).map(
      (r) => r[0]
    );
    expect(deck).toEqual(['q-new', 'q-old']);
  });

  it('hands out AI review slots up to the quota and takes a release back', () => {
    const claim = () => query(`select * from public.claim_ai_review('${LEARNER}', 2, 3);`)[0][0];
    expect([claim(), claim(), claim()]).toEqual(['t', 't', 'f']);
    query(`select public.release_ai_review('${LEARNER}');`);
    expect(claim()).toBe('t');
  });

  it('shows a learner their own rows and nobody else’s', () => {
    completeLesson(questions);

    expect(query(`select user_id from public.game_state;`, { role: 'authenticated' })).toEqual([
      [LEARNER],
    ]);
    expect(
      query(`select user_id from public.game_state;`, { role: 'authenticated', user: OTHER })
    ).toEqual([[OTHER]]);
  });

  it('refuses a client that tries to mint XP or grant itself Pro', () => {
    const asOther = { role: 'authenticated', user: OTHER } as const;
    expect(
      refused(
        `insert into public.xp_events (user_id, amount, source) values ('${OTHER}', 9999, 'lesson');`,
        asOther
      )
    ).toBe(true);
    expect(
      refused(
        `insert into public.subscriptions (user_id, rc_app_user_id, entitlement, status)
           values ('${OTHER}','${OTHER}','pro','active');`,
        asOther
      )
    ).toBe(true);
    // An update finds nothing to change rather than raising: with no policy for
    // it, RLS makes every row invisible to the statement. What matters is that
    // the XP is still what the RPC set.
    query(`update public.game_state set total_xp = 999999 where user_id = '${OTHER}';`, asOther);
    const [[totalXp]] = query(`select total_xp from public.game_state where user_id = '${OTHER}';`);
    expect(number(totalXp)).toBe(0);
  });
});
