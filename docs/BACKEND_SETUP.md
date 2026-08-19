# Backend setup

Everything the app needs on the server side, in the order it has to happen.
Each step is independent: the app runs (with that feature degraded) if you skip
one, so you can bring them up gradually.

| Piece                         | Without it                                                     |
| ----------------------------- | -------------------------------------------------------------- |
| Supabase project + migrations | The app runs entirely on the device (see below)                |
| RevenueCat                    | Everyone is a free user; the paywall shows "store unavailable" |
| RevenueCat webhook            | Subscribers still get the app, but AI grading refuses them     |
| AI provider key               | The explain-the-code question returns "grader unavailable"     |
| Apple client secret           | Account deletion works but does not revoke the Apple grant     |

None of it is needed to run the app. With no `EXPO_PUBLIC_SUPABASE_URL` the
whole game runs on the device — `services/local/` implements every RPC below
against one AsyncStorage document, using the same rules (`lib/scoring.ts`) the
SQL applies. That is what a fresh clone does. Setting the Supabase URL and key
is what switches the app onto everything described here; nothing else in this
file changes that decision.

---

## 1. Supabase

```bash
npm run supabase:login
npm run supabase:link          # pick the project
npm run supabase:push          # applies both migrations
npm run supabase:gen-types     # refreshes lib/database.types.ts
```

The migrations create:

- `profiles`, `game_state`, `lesson_progress`, `question_attempts`, `xp_events`
- `subscriptions` — the RevenueCat mirror, written only by the webhook
- `question_rubrics` — grading rubrics for the AI questions, seeded from `content/`
- `ai_reviews`, `ai_review_quota` — the AI grading log and its rate limit
- `apple_credentials` — Apple refresh tokens, used only to revoke a sign-in grant

and the RPCs the client is allowed to call: `record_answer`, `complete_lesson`,
`get_game_state`, `refill_hearts`, `record_practice`, `get_mistake_questions`.

XP, hearts and streaks are only ever changed by those functions. The tables
themselves grant `select` to their owner and nothing else, so a modified client
cannot mint XP.

Whenever the question bank changes, regenerate the rubric seed and push it:

```bash
npm run content:check          # validates and really runs the snippets
npm run content:seed           # rewrites the rubric migration
npm run supabase:push
```

### Auth providers

Google and Apple are configured in the Supabase dashboard, not in `.env`.
See [OAUTH_SETUP.md](./OAUTH_SETUP.md). The redirect URL is `codeling://auth/callback`.

---

## 2. Edge functions

```bash
npx supabase functions deploy grade-explanation
npx supabase functions deploy delete-account
npx supabase functions deploy apple-token-exchange
npx supabase functions deploy revenuecat-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook is **required**: RevenueCat authenticates with a
static secret in the `Authorization` header, which Supabase would otherwise try
to parse as a Supabase JWT and reject before the handler runs. This is the single
most common reason a RevenueCat → Supabase webhook silently never fires. The
function checks the secret itself.

### Secrets

```bash
npm run supabase:secrets:set \
  AI_API_KEY=... \
  AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai \
  AI_MODEL=gemini-2.5-flash-lite \
  REVENUECAT_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  REVENUECAT_API_KEY=sk_... \
  APPLE_CLIENT_ID=com.planor.codeling \
  APPLE_CLIENT_SECRET=...
```

---

## 3. The AI grader

`grade-explanation` talks to any OpenAI-compatible `/chat/completions` endpoint,
so the provider is three environment variables rather than a code change.

| Provider         | `AI_BASE_URL`                                             | `AI_MODEL`              | ~cost / 1k gradings |
| ---------------- | --------------------------------------------------------- | ----------------------- | ------------------- |
| Google (default) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash-lite` | ~$0.14              |
| Groq             | `https://api.groq.com/openai/v1`                          | `openai/gpt-oss-20b`    | ~$0.11              |
| DeepSeek         | `https://api.deepseek.com`                                | `deepseek-v4-flash`     | ~$0.14              |

Three things worth knowing before you switch:

1. **Use a paid key.** Google's free tier allows prompts to be used for training,
   and these prompts contain learner-written text.
2. **Turkish costs 1.5-2x the tokens of English.** The function already sizes
   `max_tokens` per locale and retries once when the model runs out of room;
   a provider swap should keep that behaviour in mind.
3. **Strict JSON support is not universal.** On Groq, `strict: true` genuinely
   constrains decoding only on the `gpt-oss` models; elsewhere it degrades to
   best-effort and can return invalid JSON.

Cost control is enforced in Postgres, not in the function: `claim_ai_review`
increments an hourly and a daily counter atomically **before** the model is
called, so a scripted client cannot outrun the limiter (30/hour, 200/day).

---

## 4. RevenueCat

1. Create the app in RevenueCat and add the App Store Connect shared secret.
2. Create an entitlement with the identifier **`pro`** and attach the products.
   A missing or misspelled entitlement fails silently: purchases succeed and
   every access check returns false.
3. Create an offering (identifier `default`) with weekly / monthly / annual
   packages.
4. In App Store Connect, add a **3-day free trial** introductory offer to the
   subscription group. Apple grants one introductory offer per subscription
   group per Apple ID, so the paywall only promises the trial when the store
   confirms eligibility.
5. Point the webhook at
   `https://<project>.functions.supabase.co/revenuecat-webhook` with the header
   `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`.
6. Put the public SDK keys in `.env` as `EXPO_PUBLIC_REVENUECAT_IOS_KEY` /
   `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.

Notes that cost time if you learn them the hard way:

- `react-native-purchases` has **no Expo config plugin**. Do not add it to
  `app.json` → `plugins`; it is an ordinary autolinked module and only needs a
  development build.
- Inside Expo Go, `configure()` **throws** for any key that is not a Test Store
  key. The app detects Expo Go and skips configuration instead.
- The webhook treats `CANCELLATION` as "auto-renew off", not "revoke" — access
  continues until `EXPIRATION`. `BILLING_ISSUE` maps to a grace period for the
  same reason.
- Events are retried and can arrive out of order, so the mirror stores the last
  applied `event.id` and its timestamp and refuses duplicates and stale events.

---

## 5. Sign in with Apple revocation

App Store Review 5.1.1(v) requires in-app account deletion, and Apple requires
apps offering Sign in with Apple to revoke the grant when the account goes.

```bash
npm run generate:apple-secret   # writes the client secret JWT (max 6 months)
```

Set it as `APPLE_CLIENT_SECRET`, with `APPLE_CLIENT_ID` set to the bundle
identifier. The flow is:

1. `lib/auth.ts` captures Apple's one-time `authorizationCode` at sign-in and
   posts it to `apple-token-exchange`.
2. That function exchanges it for a refresh token and stores it in
   `apple_credentials` (service role only — no client role can read it).
3. `delete-account` revokes the token with Apple, then deletes the `auth.users`
   row, which cascades through every table.

**The secret expires.** Regenerate it before six months are up, or deletion stops
revoking (and Apple's review will notice).
