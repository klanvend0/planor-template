# Codeling

A mobile game for learning to code. Short puzzles instead of long tutorials:
fill in the blank, type the missing line, spot the bug, pick the output — and, for
subscribers, explain what a snippet does in your own words and have an AI tell you
exactly what you understood and what you missed.

iOS first, Turkish and English throughout, 336 questions across a Python and a
JavaScript course.

## What is in here

| Area                                               | Where                |
| -------------------------------------------------- | -------------------- |
| Screens                                            | `app/` (Expo Router) |
| Question views, HUD, illustrations                 | `components/`        |
| Content schema, grading rules, gamification, theme | `lib/`               |
| Supabase, RevenueCat, AI grading, notifications    | `services/`          |
| Client state                                       | `stores/`            |
| The question bank                                  | `content/`           |
| Database + edge functions                          | `supabase/`          |

## Stack

- **Expo SDK 57** (React Native 0.86, React 19.2, New Architecture)
- **Expo Router 57** — file-based routes; note that since SDK 56 it no longer
  depends on React Navigation, so themes and tab types come from `expo-router`
- **NativeWind 4** (Tailwind v3) with CSS-variable design tokens
- **React Native Reusables** (`@rn-primitives/*`) for the shadcn-style primitives
- **Supabase** — auth, Postgres, edge functions (optional: without it the app
  runs on the device, see below)
- **RevenueCat** — subscriptions with a 3-day free trial
- **Zustand** for state, **Zod** for validating anything that crosses a boundary

## Getting started

```bash
npm install
npm run dev
```

That is the whole setup. With no `.env` the app runs entirely on the device:
sign-in becomes "start learning", progress is kept in AsyncStorage under the
same rules the server applies, the paywall sells a local entitlement and says
plainly that nothing is charged, and explanations are marked against the key
points the question bank already ships. Every screen works and nothing leaves
the phone — enough to write lessons, build screens, and see the whole flow.

To run against real infrastructure:

```bash
cp .env.example .env        # Supabase decides; RevenueCat and the rest are optional
```

`.env.example` lists every variable and what happens when it is missing.
Setting `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` is what
switches the app from the device to the backend — accounts, server-authoritative
XP, the AI grader and RevenueCat. Backend setup — migrations, edge functions,
the AI provider, the webhook and Apple's revoke flow — is in
[docs/BACKEND_SETUP.md](docs/BACKEND_SETUP.md).

RevenueCat is a native module and throws inside Expo Go, so working on the real
store flow needs a development build:

```bash
npx eas build --profile development --platform ios
```

## Everyday commands

```bash
npm run dev             # start the dev server
npm run ios             # run on a simulator/device
npm test                # unit tests
npm run typecheck       # tsc --noEmit
npm run format          # prettier
npm run content:check   # validate the question bank AND run every snippet
npm run content:seed    # regenerate the AI grading rubric migration
npm run icon:build      # re-render every app icon variant from vector source
npm run expo:doctor     # dependency sanity check
```

## How the game works

**Lessons.** Each lesson opens with a teaching card — one idea, one worked
example — then asks six questions about exactly that idea. Wrong answers go back
into the queue and come round again, so a lesson ends when everything has been
answered right at least once. Score is first-attempt accuracy.

**Hearts.** A wrong answer costs a heart; hearts regenerate one per 30 minutes,
and subscribers have unlimited. Running out is not a dead end — the learner can
wait, take their one free daily refill, practise old mistakes for free, or
subscribe.

**XP, levels, streaks, leagues.** XP is paid per question difficulty, with a bonus
for a flawless lesson and one every seventh streak day. Weekly XP puts the learner
in a league (bronze → diamond) that is computed from their own numbers — there is
no social leaderboard and no other learner's data anywhere in the app.

**The premium question.** Every lesson's last question shows a snippet whose
comments are written in the learner's language and asks for a 100-200 character
explanation. A cheap model grades it against a rubric that lives in Postgres,
returning a verdict, a score, what to fix and what was missed. Free users see the
question, an honest description of what it does, and a way past it.

All of this is decided by the database, not the client: `record_answer`,
`complete_lesson` and `record_practice` are `SECURITY DEFINER` functions, and no
client role holds `insert` or `update` on the tables behind them.

## Content

The question bank lives in `content/<course>/unit_NN.json` and ships inside the
app, so a lesson starts instantly and works offline. `content/AUTHORING.md` is the
contract; `npm run content:check` enforces it and **actually executes** every
snippet with `python3` / `node`, so a question whose "correct" answer does not run
cannot ship.

Progress, attempts and XP are the only things stored server-side.

## Offline

Lessons are playable without a connection. Answers and lesson results are queued
in `stores/sync_queue.ts` and replayed when the app next reaches the network; the
local game state is updated optimistically with the same rules Postgres applies,
so the two agree once the queue drains.

## Tests

```bash
npm test
```

Coverage is deliberately concentrated where being wrong costs the learner
something: answer grading (`lib/answer_check.ts`) and the reward curve
(`lib/gamification.ts`).

## Shipping

`eas.json` carries development, preview and production profiles. Before the first
submission, replace the placeholders in `app.json` (`appleTeamId`, bundle
identifier) and `eas.json` (`appleId`, `ascAppId`), and point the Terms and
Privacy Policy links in `.env` at real pages — App Store review checks that they
resolve, both in the app and in App Store Connect metadata.
