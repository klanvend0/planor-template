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
--   * Question content itself is bundled with the app; only the grading rubric of
--     AI-graded questions is mirrored here so the edge function never trusts the
--     client for it.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
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
  created_at timestamptz not null default now()
);

create index if not exists question_attempts_user_created_idx
  on public.question_attempts (user_id, created_at desc);
create index if not exists question_attempts_user_question_idx
  on public.question_attempts (user_id, question_id);
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
  earned_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index if not exists xp_events_user_day_idx on public.xp_events (user_id, earned_on desc);

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
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
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

  if not found then
    return null;
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

/** True when the caller currently owns an active entitlement. */
create or replace function public.has_active_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_active from public.subscriptions where user_id = p_user_id), false);
$$;

-- ---------------------------------------------------------------------------
-- Gameplay RPCs
-- ---------------------------------------------------------------------------

/**
 * Records one answer. Returns the hearts left afterwards.
 * A wrong answer costs a heart unless the learner has an active subscription.
 */
create or replace function public.record_answer(
  p_question_id text,
  p_lesson_id text,
  p_course_id text,
  p_question_type text,
  p_is_correct boolean,
  p_answer text default null,
  p_duration_ms integer default null
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
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  insert into public.question_attempts (
    user_id, question_id, lesson_id, course_id, question_type, is_correct, answer, duration_ms
  ) values (
    v_user, p_question_id, p_lesson_id, p_course_id, p_question_type, p_is_correct,
    left(coalesce(p_answer, ''), 500), p_duration_ms
  );

  v_unlimited := public.has_active_subscription(v_user);
  v_hearts := public.settle_hearts(v_user);

  if not p_is_correct and not v_unlimited then
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
 * Completes a lesson: awards XP once per improvement, advances the streak,
 * and returns the fresh game state. Called after the last question of a lesson.
 *
 * Scoring: `p_correct` / `p_total` becomes a 0-100 score; 3 stars at 100%,
 * 2 stars from 80%, 1 star from 50%.
 */
create or replace function public.complete_lesson(
  p_lesson_id text,
  p_unit_id text,
  p_course_id text,
  p_correct integer,
  p_total integer,
  p_base_xp integer
)
returns table (
  total_xp integer,
  xp_awarded integer,
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
  v_score smallint;
  v_stars smallint;
  v_previous public.lesson_progress%rowtype;
  v_first boolean := false;
  v_award integer := 0;
  v_perfect_bonus integer := 0;
  v_streak_bonus integer := 0;
  v_today date := (now() at time zone 'utc')::date;
  v_state public.game_state%rowtype;
  v_daily integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_total <= 0 then
    raise exception 'a lesson needs at least one question';
  end if;
  if p_base_xp < 0 or p_base_xp > 500 then
    raise exception 'implausible xp payload';
  end if;

  v_score := round((p_correct::numeric / p_total) * 100)::smallint;
  v_stars := case when v_score = 100 then 3 when v_score >= 80 then 2 when v_score >= 50 then 1 else 0 end;

  select * into v_previous from public.lesson_progress
    where user_id = v_user and lesson_id = p_lesson_id;

  v_first := v_previous.user_id is null or v_previous.status <> 'completed';

  -- XP is proportional to how much of the lesson was answered correctly, and is
  -- only paid out on the first completion or when the learner beats their score.
  if v_first then
    v_award := round(p_base_xp * (v_score / 100.0))::integer;
  elsif v_score > coalesce(v_previous.best_score, 0) then
    v_award := round(p_base_xp * ((v_score - v_previous.best_score) / 100.0))::integer;
  end if;

  if v_score = 100 and (v_first or coalesce(v_previous.best_score, 0) < 100) then
    v_perfect_bonus := 10;
  end if;

  insert into public.lesson_progress as lp (
    user_id, lesson_id, course_id, unit_id, status, best_score, stars, attempts, xp_earned, first_completed_at
  ) values (
    v_user, p_lesson_id, p_course_id, p_unit_id,
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

  select * into v_state from public.game_state where user_id = v_user for update;
  if not found then
    insert into public.game_state (user_id) values (v_user) returning * into v_state;
  end if;

  -- Streak: same day is a no-op, yesterday extends, anything older resets
  -- unless a streak freeze is available to cover exactly one missed day.
  if v_state.last_active_date is null then
    v_state.streak_days := 1;
  elsif v_state.last_active_date = v_today then
    null;
  elsif v_state.last_active_date = v_today - 1 then
    v_state.streak_days := v_state.streak_days + 1;
  elsif v_state.last_active_date = v_today - 2 and v_state.streak_freezes > 0 then
    v_state.streak_days := v_state.streak_days + 1;
    v_state.streak_freezes := (v_state.streak_freezes - 1)::smallint;
  else
    v_state.streak_days := 1;
  end if;

  if v_state.last_active_date is distinct from v_today and v_state.streak_days > 0
     and v_state.streak_days % 7 = 0 then
    v_streak_bonus := 25;
  end if;

  update public.game_state set
    total_xp = total_xp + v_award + v_perfect_bonus + v_streak_bonus,
    streak_days = v_state.streak_days,
    longest_streak = greatest(longest_streak, v_state.streak_days),
    streak_freezes = v_state.streak_freezes,
    last_active_date = v_today,
    lessons_completed = lessons_completed + case when v_first and v_score >= 50 then 1 else 0 end,
    perfect_lessons = perfect_lessons + case when v_score = 100 and v_perfect_bonus > 0 then 1 else 0 end,
    updated_at = now()
  where user_id = v_user
  returning * into v_state;

  if v_award > 0 then
    insert into public.xp_events (user_id, amount, source, lesson_id)
    values (v_user, v_award, 'lesson', p_lesson_id);
  end if;
  if v_perfect_bonus > 0 then
    insert into public.xp_events (user_id, amount, source, lesson_id)
    values (v_user, v_perfect_bonus, 'perfect_bonus', p_lesson_id);
  end if;
  if v_streak_bonus > 0 then
    insert into public.xp_events (user_id, amount, source, lesson_id)
    values (v_user, v_streak_bonus, 'streak_bonus', p_lesson_id);
  end if;

  select coalesce(sum(amount), 0)::integer into v_daily
    from public.xp_events where user_id = v_user and earned_on = v_today;

  return query select
    v_state.total_xp,
    (v_award + v_perfect_bonus + v_streak_bonus),
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
      coalesce((select sum(amount)::integer from public.xp_events e
                where e.user_id = v_user and e.earned_on = v_today), 0),
      coalesce((select sum(amount)::integer from public.xp_events e
                where e.user_id = v_user and e.earned_on > v_today - 7), 0),
      public.has_active_subscription(v_user)
    from public.game_state gs
    where gs.user_id = v_user;
end;
$$;

/** Refills hearts to full. Free once every 24h; subscribers never need it. */
create or replace function public.refill_hearts()
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_hearts smallint;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.game_state
    set hearts = 5, hearts_updated_at = now(), updated_at = now()
    where user_id = v_user
      and (public.has_active_subscription(v_user) or hearts_updated_at < now() - interval '24 hours')
    returning hearts into v_hearts;

  if v_hearts is null then
    raise exception 'hearts can only be refilled once a day on the free plan'
      using errcode = 'P0001';
  end if;

  return v_hearts;
end;
$$;

/** The last N distinct questions the learner got wrong, for the mistakes deck. */
create or replace function public.get_mistake_questions(p_course_id text, p_limit integer default 20)
returns table (question_id text, lesson_id text, missed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (qa.question_id) qa.question_id, qa.lesson_id, qa.created_at
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
  limit least(coalesce(p_limit, 20), 50);
$$;

grant execute on function public.record_answer(text, text, text, text, boolean, text, integer) to authenticated;
grant execute on function public.complete_lesson(text, text, text, integer, integer, integer) to authenticated;
grant execute on function public.get_game_state() to authenticated;
grant execute on function public.refill_hearts() to authenticated;
grant execute on function public.get_mistake_questions(text, integer) to authenticated;
grant execute on function public.has_active_subscription(uuid) to authenticated;

revoke execute on function public.settle_hearts(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

/**
 * Records a practice run (mistakes deck or quick review).
 *
 * Practice is deliberately cheaper than a lesson: 5 XP per correct answer,
 * capped at 50 XP a day, so grinding old questions cannot outpace learning new
 * ones. It never touches hearts, stars or the streak.
 */
create or replace function public.record_practice(
  p_course_id text,
  p_correct integer,
  p_total integer
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
  v_total integer;
  v_daily integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_total <= 0 or p_correct < 0 or p_correct > p_total or p_total > 50 then
    raise exception 'implausible practice payload';
  end if;

  select coalesce(sum(amount), 0)::integer into v_already
    from public.xp_events
    where user_id = v_user and source = 'practice' and earned_on = v_today;

  v_award := greatest(0, least(p_correct * 5, 50 - v_already));

  if v_award > 0 then
    insert into public.xp_events (user_id, amount, source) values (v_user, v_award, 'practice');
    update public.game_state
      set total_xp = total_xp + v_award, updated_at = now()
      where user_id = v_user;
  end if;

  select gs.total_xp into v_total from public.game_state gs where gs.user_id = v_user;
  select coalesce(sum(amount), 0)::integer into v_daily
    from public.xp_events where user_id = v_user and earned_on = v_today;

  return query select v_award, coalesce(v_total, 0), v_daily;
end;
$$;

grant execute on function public.record_practice(text, integer, integer) to authenticated;

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
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, window_start)
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
  insert into public.ai_review_quota (user_id, window_start, used)
  values (p_user_id, v_hour, 1)
  on conflict (user_id, window_start)
    do update set used = public.ai_review_quota.used + 1
  returning used into v_hour_used;

  insert into public.ai_review_quota (user_id, window_start, used)
  values (p_user_id, v_day, 1)
  on conflict (user_id, window_start)
    do update set used = public.ai_review_quota.used + 1
  returning used into v_day_used;

  if v_hour_used > p_hourly or v_day_used > p_daily then
    -- Give the slot back so a rejected request does not consume quota.
    update public.ai_review_quota set used = greatest(0, used - 1)
      where user_id = p_user_id and window_start in (v_hour, v_day);
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
