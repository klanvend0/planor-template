-- Codeling core schema.
--
-- Everything a learner accumulates lives here: profile, game state (XP, hearts,
-- streak), per-lesson progress, individual question attempts, the XP ledger, the
-- RevenueCat subscription mirror and the AI review log.
--
-- Design constraints:
--   * Every table is row-level-secured to its owner; the subscription mirror is
--     writable only by the service role (the RevenueCat webhook).
--   * Game state is advanced through SECURITY DEFINER functions so the client can
--     never mint XP, refill hearts or fake a streak by writing rows directly.
--   * Question content itself is bundled with the app; what each lesson is worth
--     and the rubric of every AI-graded question are mirrored here, so neither
--     the payout nor the grading standard is taken from the client.
--
-- Threat model, stated plainly:
--   A tampered client CAN claim it answered correctly — the answers for every
--   non-AI question ship inside the app, so grading them server-side would
--   change nothing. What it CANNOT do is decide what that claim is worth: the
--   question count and the XP come from `lesson_catalog`, XP is paid only for
--   improvement over the lesson's best score, practice is capped per day, and
--   the one feature that costs real money (AI grading) is gated on the
--   subscription mirror and an atomic per-user quota. The worst outcome is a
--   learner inflating their own numbers, which costs nothing and fools nobody.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'en' check (locale in ('en', 'tr')),
  active_course text not null default 'python' check (active_course in ('python', 'javascript')),
  daily_goal_xp integer not null default 50 check (daily_goal_xp in (20, 50, 100, 200)),
  reminder_hour smallint check (reminder_hour between 0 and 23),
  onboarding_completed boolean not null default false,
  experience_level text not null default 'new' check (experience_level in ('new', 'some', 'confident')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per user: preferences captured during onboarding.';

-- ---------------------------------------------------------------------------
-- game_state
-- ---------------------------------------------------------------------------

create table if not exists public.game_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  total_xp integer not null default 0 check (total_xp >= 0),
  hearts smallint not null default 5 check (hearts between 0 and 5),
  hearts_updated_at timestamptz not null default now(),
  streak_days integer not null default 0 check (streak_days >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_active_date date,
  streak_freezes smallint not null default 0 check (streak_freezes between 0 and 2),
  lessons_completed integer not null default 0 check (lessons_completed >= 0),
  perfect_lessons integer not null default 0 check (perfect_lessons >= 0),
  -- Tracked separately from hearts_updated_at, which moves every time hearts
  -- regenerate and so can never be used to gate a once-a-day action.
  last_free_refill_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.game_state is 'Server-authoritative gamification state; mutated only through RPCs.';
comment on column public.game_state.hearts is 'Hearts left. Regenerates one per 30 minutes up to 5; subscribers are never charged.';

-- ---------------------------------------------------------------------------
-- lesson_progress
-- ---------------------------------------------------------------------------

create table if not exists public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  course_id text not null check (course_id in ('python', 'javascript')),
  unit_id text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  best_score smallint not null default 0 check (best_score between 0 and 100),
  stars smallint not null default 0 check (stars between 0 and 3),
  attempts integer not null default 0 check (attempts >= 0),
  xp_earned integer not null default 0 check (xp_earned >= 0),
  first_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create index if not exists lesson_progress_user_course_idx
  on public.lesson_progress (user_id, course_id, unit_id);

-- ---------------------------------------------------------------------------
-- question_attempts
-- ---------------------------------------------------------------------------

create table if not exists public.question_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id text not null,
  lesson_id text not null,
  course_id text not null check (course_id in ('python', 'javascript')),
  question_type text not null,
  is_correct boolean not null,
  answer text,
  duration_ms integer check (duration_ms >= 0),
  -- Minted by the client before the first attempt to write this answer, and
  -- replayed verbatim by the offline queue. It is what makes `record_answer`
  -- idempotent: a response lost after the row committed must not cost a second
  -- heart when the queue retries. Null for any caller that does not send one.
  attempt_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists question_attempts_user_created_idx
  on public.question_attempts (user_id, created_at desc);
create index if not exists question_attempts_user_question_idx
  on public.question_attempts (user_id, question_id);
create unique index if not exists question_attempts_attempt_idx
  on public.question_attempts (user_id, attempt_id)
  where attempt_id is not null;
create index if not exists question_attempts_mistakes_idx
  on public.question_attempts (user_id, is_correct, created_at desc)
  where is_correct = false;

comment on table public.question_attempts is 'Every answer, used for the mistakes-practice deck and for analytics.';

-- ---------------------------------------------------------------------------
-- xp_events
-- ---------------------------------------------------------------------------

create table if not exists public.xp_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount integer not null check (amount > 0),
  source text not null check (source in ('lesson', 'perfect_bonus', 'streak_bonus', 'daily_goal', 'practice', 'ai_review')),
  lesson_id text,
  -- The client's id for one practice run. A retried call carries the same one,
  -- which is what stops a lost response from paying the run twice.
  run_id uuid,
  earned_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index if not exists xp_events_user_day_idx on public.xp_events (user_id, earned_on desc);
create unique index if not exists xp_events_run_idx
  on public.xp_events (user_id, run_id)
  where run_id is not null;

comment on table public.xp_events is 'Append-only XP ledger; daily goals and weekly leagues are derived from it.';

-- ---------------------------------------------------------------------------
-- subscriptions (RevenueCat mirror)
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rc_app_user_id text,
  entitlement text,
  product_id text,
  store text,
  status text not null default 'expired'
    check (status in ('trialing', 'active', 'grace', 'expired', 'cancelled', 'billing_issue', 'paused')),
  is_active boolean generated always as (status in ('trialing', 'active', 'grace')) stored,
  period_type text,
  current_period_end timestamptz,
  trial_end timestamptz,
  will_renew boolean not null default false,
  environment text,
  -- Webhook idempotency: RevenueCat retries events and can deliver them out of
  -- order, so the last applied event id and its timestamp are kept to drop
  -- duplicates and refuse to apply an older event over a newer one.
  rc_event_id text,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  raw_event jsonb
);

create index if not exists subscriptions_rc_app_user_idx on public.subscriptions (rc_app_user_id);

comment on table public.subscriptions is 'Mirror of RevenueCat entitlements, written only by the webhook (service role).';

-- ---------------------------------------------------------------------------
-- lesson_catalog
-- ---------------------------------------------------------------------------

/**
 * What each lesson is worth, mirrored from the bundled content by
 * `npm run content:seed`.
 *
 * Without it the client would tell the server how much XP to pay out and how
 * many questions a lesson has, which is an invitation to mint XP. With it the
 * client only reports how many it answered correctly.
 */
create table if not exists public.lesson_catalog (
  lesson_id text primary key,
  unit_id text not null,
  course_id text not null check (course_id in ('python', 'javascript')),
  question_count smallint not null check (question_count between 1 and 20),
  base_xp integer not null check (base_xp between 1 and 500),
  -- The share of the lesson only subscribers can answer. A free learner is
  -- never shown those questions, so scoring them against the full lesson would
  -- cap every run they can play at 83% — no third star, no perfect bonus, ever.
  premium_question_count smallint not null default 0
    check (premium_question_count between 0 and 20),
  premium_xp integer not null default 0 check (premium_xp between 0 and 500),
  updated_at timestamptz not null default now()
);

alter table public.lesson_catalog enable row level security;

create policy "the catalog is readable by signed in users"
  on public.lesson_catalog for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- question_rubrics + ai_reviews (the premium "explain this code" feature)
-- ---------------------------------------------------------------------------

create table if not exists public.question_rubrics (
  question_id text primary key,
  course_id text not null check (course_id in ('python', 'javascript')),
  lesson_id text not null,
  code_en text not null,
  code_tr text not null,
  key_points_en jsonb not null,
  key_points_tr jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.question_rubrics is
  'Grading rubric for explain_code questions. The edge function reads it here so a tampered client cannot rewrite its own rubric.';

create table if not exists public.ai_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  question_id text not null,
  locale text not null check (locale in ('en', 'tr')),
  answer text not null,
  verdict text not null check (verdict in ('correct', 'partial', 'incorrect')),
  score smallint not null check (score between 0 and 100),
  summary text not null,
  corrections jsonb not null default '[]'::jsonb,
  missed_points jsonb not null default '[]'::jsonb,
  model text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_reviews_user_created_idx on public.ai_reviews (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.game_state enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.question_attempts enable row level security;
alter table public.xp_events enable row level security;
alter table public.subscriptions enable row level security;
alter table public.question_rubrics enable row level security;
alter table public.ai_reviews enable row level security;

create policy "profiles are self service"
  on public.profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy "game state is readable by its owner"
  on public.game_state for select to authenticated
  using (auth.uid() = user_id);

create policy "lesson progress is readable by its owner"
  on public.lesson_progress for select to authenticated
  using (auth.uid() = user_id);

create policy "question attempts are readable by their owner"
  on public.question_attempts for select to authenticated
  using (auth.uid() = user_id);

create policy "xp events are readable by their owner"
  on public.xp_events for select to authenticated
  using (auth.uid() = user_id);

create policy "subscriptions are readable by their owner"
  on public.subscriptions for select to authenticated
  using (auth.uid() = user_id);

create policy "rubrics are readable by signed in users"
  on public.question_rubrics for select to authenticated
  using (true);

create policy "ai reviews are readable by their owner"
  on public.ai_reviews for select to authenticated
  using (auth.uid() = user_id);

-- Writes to game state, progress, XP and reviews go through SECURITY DEFINER
-- functions below, so no INSERT/UPDATE policies are granted to `authenticated`.

-- ---------------------------------------------------------------------------
-- Bootstrap: create profile + game state for every new auth user
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The provider also hands over an avatar URL. It is not copied here: nothing
  -- in the app shows one, and data that is never used is data that only has to
  -- be declared, stored and deleted.
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;

  insert into public.game_state (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, status) values (new.id, 'expired')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

/**
 * Hearts regenerate one per 30 minutes, capped at 5. Rather than running a cron
 * job we store the last change and settle the balance whenever it is read or spent.
 */
create or replace function public.settle_hearts(p_user_id uuid)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hearts smallint;
  v_since timestamptz;
  v_regen integer;
begin
  select hearts, hearts_updated_at into v_hearts, v_since
  from public.game_state where user_id = p_user_id for update;

  -- A learner whose trigger-created row is missing (restored backup, manual
  -- insert into auth.users) would otherwise be stranded with zero hearts.
  if not found then
    insert into public.game_state (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
    select hearts, hearts_updated_at into v_hearts, v_since
    from public.game_state where user_id = p_user_id for update;
    if not found then
      return null;
    end if;
  end if;

  if v_hearts >= 5 then
    update public.game_state set hearts_updated_at = now() where user_id = p_user_id;
    return v_hearts;
  end if;

  v_regen := floor(extract(epoch from (now() - v_since)) / 1800)::integer;
  if v_regen > 0 then
    v_hearts := least(5, v_hearts + v_regen)::smallint;
    update public.game_state
      set hearts = v_hearts,
          hearts_updated_at = case when v_hearts >= 5 then now() else v_since + (v_regen * interval '30 minutes') end,
          updated_at = now()
      where user_id = p_user_id;
  end if;

  return v_hearts;
end;
$$;

/**
 * True when the learner currently owns an active entitlement.
 *
 * The paid-through date is checked as well as the status: if an EXPIRATION
 * webhook is ever lost, the mirror would otherwise keep saying "active" forever.
 */
create or replace function public.has_active_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.is_active
        and (s.current_period_end is null or s.current_period_end > now())
      from public.subscriptions s
      where s.user_id = p_user_id
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Gameplay RPCs
-- ---------------------------------------------------------------------------

/**
 * Records one answer. Returns the hearts left afterwards.
 *
 * A wrong answer costs a heart unless the learner has an active subscription or
 * the answer came from a practice run — practice is a warm-up over questions
 * already met, so it never puts the lesson path out of reach.
 *
 * @param p_attempt_id  The client's id for this attempt. Replaying it is free:
 *                      the row is already there, so no second heart is spent.
 *                      The offline queue is at-least-once, so it always sends
 *                      one.
 */
create or replace function public.record_answer(
  p_question_id text,
  p_lesson_id text,
  p_course_id text,
  p_question_type text,
  p_is_correct boolean,
  p_answer text default null,
  p_duration_ms integer default null,
  p_practice boolean default false,
  p_attempt_id uuid default null
)
returns table (hearts_left smallint, unlimited_hearts boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_unlimited boolean;
  v_hearts smallint;
  -- `get diagnostics ... row_count` is an integer, and 0 means the insert hit
  -- the idempotency index rather than writing a new attempt.
  v_recorded integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.question_attempts (
    user_id, question_id, lesson_id, course_id, question_type, is_correct, answer, duration_ms,
    attempt_id
  ) values (
    v_user, p_question_id, p_lesson_id, p_course_id, p_question_type, p_is_correct,
    left(coalesce(p_answer, ''), 500), p_duration_ms, p_attempt_id
  )
  on conflict (user_id, attempt_id) where attempt_id is not null do nothing;

  get diagnostics v_recorded = row_count;

  v_unlimited := public.has_active_subscription(v_user);
  -- Hearts still have to settle on a replay: the learner may have been away
  -- long enough to regenerate some.
  v_hearts := public.settle_hearts(v_user);

  -- A replay of an answer that already landed returns the current balance
  -- without charging for it again.
  if v_recorded > 0 and not p_is_correct and not v_unlimited and not coalesce(p_practice, false) then
    update public.game_state
      set hearts = greatest(0, hearts - 1)::smallint,
          hearts_updated_at = case when hearts = 5 then now() else hearts_updated_at end,
          updated_at = now()
      where user_id = v_user
      returning hearts into v_hearts;
  end if;

  return query select v_hearts, v_unlimited;
end;
$$;

/**
 * Completes a lesson: awards XP for however much the learner improved, advances
 * the streak, and returns the fresh game state.
 *
 * What the client is trusted for: how many questions it answered correctly.
 * What it is not trusted for: how many questions the lesson has, what it pays,
 * or what the score is — those come from `lesson_catalog`, which is seeded from
 * the bundled content. A tampered client can therefore claim a perfect run it
 * did not have, but it can never mint more XP than the lesson is worth, and
 * replaying a lesson pays only for the improvement over its best score.
 *
 * Scoring: `p_correct` / catalog question count becomes a 0-100 score; 3 stars
 * at 100%, 2 from 80%, 1 from 50%.
 *
 * @param p_played_on  The learner's local date, for a lesson finished offline
 *                     and synced later. Clamped to the last two days so it
 *                     cannot be used to fabricate a streak.
 */
create or replace function public.complete_lesson(
  p_lesson_id text,
  p_unit_id text,
  p_course_id text,
  p_correct integer,
  p_total integer,
  p_base_xp integer,
  p_played_on date default null
)
returns table (
  total_xp integer,
  xp_awarded integer,
  perfect_bonus integer,
  streak_bonus integer,
  streak_days integer,
  hearts smallint,
  stars smallint,
  score smallint,
  is_first_completion boolean,
  daily_xp integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_catalog public.lesson_catalog%rowtype;
  v_questions integer;
  v_base_xp integer;
  v_score smallint;
  v_stars smallint;
  v_previous public.lesson_progress%rowtype;
  v_best_before smallint := 0;
  v_first boolean := false;
  v_award integer := 0;
  v_perfect_bonus integer := 0;
  v_streak_bonus integer := 0;
  v_today date := (now() at time zone 'utc')::date;
  v_played date;
  v_state public.game_state%rowtype;
  v_daily integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_correct is null or p_correct < 0 then
    raise exception 'implausible answer count';
  end if;

  select * into v_catalog from public.lesson_catalog where lesson_id = p_lesson_id;

  if found then
    -- Score a free learner over the questions they were allowed to answer, and
    -- pay for that share of the lesson. A subscriber who skips the premium
    -- question is scored over all of it, because they could have answered it.
    if public.has_active_subscription(v_user) then
      v_questions := v_catalog.question_count;
      v_base_xp := v_catalog.base_xp;
    else
      v_questions := greatest(1, v_catalog.question_count - v_catalog.premium_question_count);
      v_base_xp := greatest(0, v_catalog.base_xp - v_catalog.premium_xp);
    end if;
  else
    -- The catalog has not been seeded (fresh project, or content newer than the
    -- last `npm run content:seed`). Fall back to the client's numbers, clamped
    -- hard enough that the worst case is one ordinary lesson's worth of XP.
    v_questions := least(greatest(coalesce(p_total, 1), 1), 20);
    v_base_xp := least(greatest(coalesce(p_base_xp, 0), 0), 200);
  end if;

  v_score := round((least(p_correct, v_questions)::numeric / v_questions) * 100)::smallint;
  v_stars := case when v_score = 100 then 3 when v_score >= 80 then 2 when v_score >= 50 then 1 else 0 end;

  -- Lock the learner's game state first: it serializes two devices (or a double
  -- tap) finishing the same lesson at once, so the award below is computed from
  -- state nobody else is mutating.
  select * into v_state from public.game_state where user_id = v_user for update;
  if not found then
    insert into public.game_state (user_id) values (v_user)
    on conflict (user_id) do nothing;
    select * into v_state from public.game_state where user_id = v_user for update;
  end if;

  select * into v_previous from public.lesson_progress
    where user_id = v_user and lesson_id = p_lesson_id for update;

  v_first := v_previous.user_id is null or v_previous.status <> 'completed';
  v_best_before := coalesce(v_previous.best_score, 0);

  -- XP is paid for improvement only, so replaying a lesson at the same score
  -- pays nothing and grinding a deliberately bad score cannot farm it either.
  if v_score > v_best_before then
    v_award := round(v_base_xp * ((v_score - v_best_before) / 100.0))::integer;
  end if;

  if v_score = 100 and v_best_before < 100 then
    v_perfect_bonus := 10;
  end if;

  insert into public.lesson_progress as lp (
    user_id, lesson_id, course_id, unit_id, status, best_score, stars, attempts, xp_earned, first_completed_at
  ) values (
    v_user, p_lesson_id, coalesce(v_catalog.course_id, p_course_id), coalesce(v_catalog.unit_id, p_unit_id),
    case when v_score >= 50 then 'completed' else 'in_progress' end,
    v_score, v_stars, 1, v_award + v_perfect_bonus,
    case when v_score >= 50 then now() else null end
  )
  on conflict (user_id, lesson_id) do update set
    status = case when excluded.best_score >= 50 or lp.status = 'completed' then 'completed' else 'in_progress' end,
    best_score = greatest(lp.best_score, excluded.best_score),
    stars = greatest(lp.stars, excluded.stars),
    attempts = lp.attempts + 1,
    xp_earned = lp.xp_earned + excluded.xp_earned,
    first_completed_at = coalesce(lp.first_completed_at, excluded.first_completed_at),
    updated_at = now();

  -- Streak: the day the lesson was played, not the day it reached the server.
  -- Clamped to the last two days so an offline claim cannot invent history.
  v_played := greatest(least(coalesce(p_played_on, v_today), v_today), v_today - 2);

  if v_state.last_active_date is null then
    v_state.streak_days := 1;
  elsif v_state.last_active_date >= v_played then
    null;
  elsif v_state.last_active_date = v_played - 1 then
    v_state.streak_days := v_state.streak_days + 1;
  elsif v_state.last_active_date = v_played - 2 and v_state.streak_freezes > 0 then
    v_state.streak_days := v_state.streak_days + 1;
    v_state.streak_freezes := (v_state.streak_freezes - 1)::smallint;
  else
    v_state.streak_days := 1;
  end if;

  -- Every seventh day pays a bonus and banks a freeze (capped at two), which is
  -- what makes the freeze branch above reachable.
  if v_state.last_active_date is distinct from v_played
     and v_state.streak_days > 0 and v_state.streak_days % 7 = 0 then
    v_streak_bonus := 25;
    v_state.streak_freezes := least(2, v_state.streak_freezes + 1)::smallint;
  end if;

  update public.game_state set
    total_xp = total_xp + v_award + v_perfect_bonus + v_streak_bonus,
    streak_days = v_state.streak_days,
    longest_streak = greatest(longest_streak, v_state.streak_days),
    streak_freezes = v_state.streak_freezes,
    last_active_date = greatest(coalesce(last_active_date, v_played), v_played),
    lessons_completed = lessons_completed + case when v_first and v_score >= 50 then 1 else 0 end,
    perfect_lessons = perfect_lessons + case when v_score = 100 and v_perfect_bonus > 0 then 1 else 0 end,
    updated_at = now()
  where user_id = v_user
  returning * into v_state;

  if v_award > 0 then
    insert into public.xp_events (user_id, amount, source, lesson_id, earned_on)
    values (v_user, v_award, 'lesson', p_lesson_id, v_played);
  end if;
  if v_perfect_bonus > 0 then
    insert into public.xp_events (user_id, amount, source, lesson_id, earned_on)
    values (v_user, v_perfect_bonus, 'perfect_bonus', p_lesson_id, v_played);
  end if;
  if v_streak_bonus > 0 then
    insert into public.xp_events (user_id, amount, source, lesson_id, earned_on)
    values (v_user, v_streak_bonus, 'streak_bonus', p_lesson_id, v_played);
  end if;

  select coalesce(sum(amount), 0)::integer into v_daily
    from public.xp_events where user_id = v_user and earned_on = v_today;

  -- The bonuses come back broken out as well as folded into the award, so the
  -- results screen can show the learner what the extra XP was for.
  return query select
    v_state.total_xp,
    (v_award + v_perfect_bonus + v_streak_bonus),
    v_perfect_bonus,
    v_streak_bonus,
    v_state.streak_days,
    v_state.hearts,
    v_stars,
    v_score,
    v_first,
    v_daily;
end;
$$;

/** Reads the caller's game state, settling regenerated hearts first. */
create or replace function public.get_game_state()
returns table (
  total_xp integer,
  hearts smallint,
  hearts_updated_at timestamptz,
  streak_days integer,
  longest_streak integer,
  last_active_date date,
  streak_freezes smallint,
  lessons_completed integer,
  perfect_lessons integer,
  -- So the app can tell a spent free refill from an available one, rather than
  -- offering a button that only produces an error.
  last_free_refill_at timestamptz,
  daily_xp integer,
  weekly_xp integer,
  has_subscription boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform public.settle_hearts(v_user);

  return query
    select
      gs.total_xp,
      gs.hearts,
      gs.hearts_updated_at,
      gs.streak_days,
      gs.longest_streak,
      gs.last_active_date,
      gs.streak_freezes,
      gs.lessons_completed,
      gs.perfect_lessons,
      gs.last_free_refill_at,
      coalesce((select sum(amount)::integer from public.xp_events e
                where e.user_id = v_user and e.earned_on = v_today), 0),
      coalesce((select sum(amount)::integer from public.xp_events e
                where e.user_id = v_user and e.earned_on > v_today - 7), 0),
      public.has_active_subscription(v_user)
    from public.game_state gs
    where gs.user_id = v_user;
end;
$$;

/**
 * Refill hearts to full.
 *
 * Free once every 24 hours, and always available to subscribers. The cooldown
 * keys off `last_free_refill_at` rather than `hearts_updated_at`, which moves
 * every time hearts regenerate and would make the free refill unreachable.
 */
create or replace function public.refill_hearts()
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_unlimited boolean;
  v_state public.game_state%rowtype;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  v_unlimited := public.has_active_subscription(v_user);

  select * into v_state from public.game_state where user_id = v_user for update;
  if not found then
    insert into public.game_state (user_id) values (v_user)
    on conflict (user_id) do nothing;
    select * into v_state from public.game_state where user_id = v_user for update;
  end if;

  if not v_unlimited
     and v_state.last_free_refill_at is not null
     and v_state.last_free_refill_at > now() - interval '24 hours' then
    raise exception 'hearts can only be refilled once a day on the free plan'
      using errcode = 'P0001';
  end if;

  update public.game_state
    set hearts = 5,
        hearts_updated_at = now(),
        last_free_refill_at = case when v_unlimited then last_free_refill_at else now() end,
        updated_at = now()
    where user_id = v_user
    returning * into v_state;

  return v_state.hearts;
end;
$$;

/**
 * The most recent questions the learner got wrong and has not since fixed.
 *
 * `distinct on` has to sort by the column it deduplicates, so newest-first is
 * applied in an outer query; sorting only inside would return whichever ids
 * happen to sort first alphabetically.
 */
create or replace function public.get_mistake_questions(p_course_id text, p_limit integer default 20)
returns table (question_id text, lesson_id text, missed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.question_id, m.lesson_id, m.missed_at
  from (
    select distinct on (qa.question_id)
      qa.question_id, qa.lesson_id, qa.created_at as missed_at
    from public.question_attempts qa
    where qa.user_id = auth.uid()
      and qa.course_id = p_course_id
      and qa.is_correct = false
      and not exists (
        select 1 from public.question_attempts later
        where later.user_id = qa.user_id
          and later.question_id = qa.question_id
          and later.is_correct = true
          and later.created_at > qa.created_at
      )
    order by qa.question_id, qa.created_at desc
  ) m
  order by m.missed_at desc
  limit least(coalesce(p_limit, 20), 50);
$$;

grant execute on function public.record_answer(text, text, text, text, boolean, text, integer, boolean, uuid) to authenticated;
grant execute on function public.complete_lesson(text, text, text, integer, integer, integer, date) to authenticated;
grant execute on function public.get_game_state() to authenticated;
grant execute on function public.refill_hearts() to authenticated;
grant execute on function public.get_mistake_questions(text, integer) to authenticated;
-- Not granted to `authenticated`: it takes a user id, so exposing it would let
-- any signed-in learner probe whether another account subscribes. The client
-- reads its own status from get_game_state().
revoke execute on function public.has_active_subscription(uuid) from public, anon, authenticated;

revoke execute on function public.settle_hearts(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

/**
 * Records a practice run (mistakes deck or quick review).
 *
 * Practice is deliberately cheaper than a lesson: 5 XP per correct answer,
 * capped at 50 XP a day, so grinding old questions cannot outpace learning new
 * ones. It never touches hearts, stars or the streak.
 *
 * The game state row is locked first so two runs finishing at once cannot both
 * see the same daily total and pay twice.
 */
create or replace function public.record_practice(
  p_course_id text,
  p_correct integer,
  p_total integer,
  p_run_id uuid default null
)
returns table (xp_awarded integer, total_xp integer, daily_xp integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_already integer;
  v_award integer;
  v_state public.game_state%rowtype;
  v_daily integer;
  v_paid integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_total <= 0 or p_correct < 0 or p_correct > p_total or p_total > 50 then
    raise exception 'implausible practice payload';
  end if;

  -- This run already paid: a retry after a lost response answers with the same
  -- numbers rather than awarding a second time.
  if p_run_id is not null then
    select amount into v_paid from public.xp_events
      where user_id = v_user and run_id = p_run_id;
    if found then
      select * into v_state from public.game_state where user_id = v_user;
      select coalesce(sum(amount), 0)::integer into v_daily
        from public.xp_events where user_id = v_user and earned_on = v_today;
      return query select v_paid, v_state.total_xp, v_daily;
      return;
    end if;
  end if;

  select * into v_state from public.game_state where user_id = v_user for update;
  if not found then
    insert into public.game_state (user_id) values (v_user)
    on conflict (user_id) do nothing;
    select * into v_state from public.game_state where user_id = v_user for update;
  end if;

  select coalesce(sum(amount), 0)::integer into v_already
    from public.xp_events
    where user_id = v_user and source = 'practice' and earned_on = v_today;

  v_award := greatest(0, least(p_correct * 5, 50 - v_already));

  if v_award > 0 then
    insert into public.xp_events (user_id, amount, source, run_id)
    values (v_user, v_award, 'practice', p_run_id);
    update public.game_state
      set total_xp = total_xp + v_award, updated_at = now()
      where user_id = v_user
      returning * into v_state;
  end if;

  select coalesce(sum(amount), 0)::integer into v_daily
    from public.xp_events where user_id = v_user and earned_on = v_today;

  return query select v_award, v_state.total_xp, v_daily;
end;
$$;

grant execute on function public.record_practice(text, integer, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- AI grading quota
-- ---------------------------------------------------------------------------

/**
 * Rolling quota for AI-graded explanations.
 *
 * Counting rows in `ai_reviews` would let a scripted client fire many requests
 * before the first one is logged, so the slot is claimed atomically here before
 * any tokens are spent. Edge function isolates are ephemeral and horizontally
 * scaled, so an in-memory limiter would not hold.
 */
create table if not exists public.ai_review_quota (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'hour' and 'day' are separate counters; without this column they collide
  -- into one row between 00:00 and 00:59, when both windows start at midnight.
  window_kind text not null check (window_kind in ('hour', 'day')),
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, window_kind, window_start)
);

alter table public.ai_review_quota enable row level security;

create policy "quota is readable by its owner"
  on public.ai_review_quota for select to authenticated
  using (auth.uid() = user_id);

/**
 * Claim one AI grading slot for a user.
 *
 * @param p_user_id  The learner asking for feedback.
 * @param p_hourly   Maximum gradings inside the current hour.
 * @param p_daily    Maximum gradings inside the current day.
 * @returns True when the slot was granted; false when a limit is reached.
 */
create or replace function public.claim_ai_review(
  p_user_id uuid,
  p_hourly integer default 30,
  p_daily integer default 200
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
  v_hour_used integer;
  v_day_used integer;
begin
  insert into public.ai_review_quota (user_id, window_kind, window_start, used)
  values (p_user_id, 'hour', v_hour, 1)
  on conflict (user_id, window_kind, window_start)
    do update set used = public.ai_review_quota.used + 1
  returning used into v_hour_used;

  insert into public.ai_review_quota (user_id, window_kind, window_start, used)
  values (p_user_id, 'day', v_day, 1)
  on conflict (user_id, window_kind, window_start)
    do update set used = public.ai_review_quota.used + 1
  returning used into v_day_used;

  if v_hour_used > p_hourly or v_day_used > p_daily then
    -- Give the slot back so a rejected request does not consume quota.
    update public.ai_review_quota set used = greatest(0, used - 1)
      where user_id = p_user_id
        and ((window_kind = 'hour' and window_start = v_hour)
          or (window_kind = 'day' and window_start = v_day));
    return false;
  end if;

  delete from public.ai_review_quota
    where user_id = p_user_id and window_start < now() - interval '2 days';

  return true;
end;
$$;

revoke execute on function public.claim_ai_review(uuid, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sign in with Apple token revocation
-- ---------------------------------------------------------------------------

/**
 * Apple refresh tokens, needed to revoke the Sign in with Apple grant when a
 * learner deletes their account — Apple requires the app to call the REST
 * revoke endpoint, and Supabase does not do it for us.
 *
 * Deliberately unreachable from the `authenticated` role: only the edge
 * functions (service role) ever read or write this table.
 */
create table if not exists public.apple_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.apple_credentials enable row level security;

comment on table public.apple_credentials is
  'Service-role only. Apple refresh tokens used solely to revoke the sign-in grant on account deletion.';

/**
 * Hands back a quota slot claimed by {@link claim_ai_review}.
 *
 * Called when the provider fails before any tokens are spent, so a bad minute
 * upstream does not eat into the learner's allowance.
 */
create or replace function public.release_ai_review(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_review_quota
    set used = greatest(0, used - 1)
    where user_id = p_user_id
      and ((window_kind = 'hour' and window_start = date_trunc('hour', now()))
        or (window_kind = 'day' and window_start = date_trunc('day', now())));
$$;

revoke execute on function public.release_ai_review(uuid) from public, anon, authenticated;
