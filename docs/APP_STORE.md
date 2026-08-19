# Shipping to the App Store

What has to be true before the first submission, and what the build commands are.
Everything marked **code** is already handled in the repo; everything marked
**you** needs a real account, a real page, or a real decision.

---

## 0. The build must not ship in local mode

With no `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` the app runs
entirely on the device: no accounts, and a paywall that grants Pro locally
without charging. That is the right behaviour for a fresh clone and the wrong
thing to submit — it would hand every reviewer and every customer a free
subscription.

So before any production build:

```bash
npx eas env:list --environment production        # the two Supabase variables, set
```

Each build profile in `eas.json` names an EAS environment (`development`,
`preview`, `production`) and takes its variables from there. A local `.env` is
not uploaded, so having the values on your machine is not enough — push them
with `eas env:create --environment production`. Do not add an `env` block to a
build profile: those values _override_ the environment's, which is how a
placeholder ends up in a signed build.

`app.config.ts` refuses to resolve a production EAS build whose Supabase
variables are missing or still the placeholders, so a misconfigured build fails
on the builder instead of becoming a signed IPA that gives Pro away. The
paywall's own copy is the other tell: a build in local mode says "Demo mode:
nothing is charged" where the billing terms should be.

---

## 1. Placeholders to replace

| Where      | Key                                                | Currently                               |
| ---------- | -------------------------------------------------- | --------------------------------------- |
| `.env`     | `IOS_BUNDLE_ID`                                    | `com.planor.codeling` from `app.json`   |
| `.env`     | `APPLE_TEAM_ID`                                    | unset — required for Sign in with Apple |
| `eas.json` | `submit.production.ios` (`appleId`, `ascAppId`)    | empty — `eas submit` prompts otherwise  |
| `.env`     | `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_PRIVACY_URL` | codeling.app placeholders               |
| `.env`     | `EXPO_PUBLIC_APP_STORE_ID`                         | empty (fill in after the first submit)  |

The Terms and Privacy URLs must resolve to real pages **before** review: they are
linked from the paywall and from Settings, and a reviewer will open both.

---

## 2. Subscription requirements (Guideline 3.1.2, Schedule 2 §3.8(b))

The paywall must disclose, in the binary and not from a remote config:

- **code** — subscription title, length, and price per period
- **code** — what the free trial is: `%{days} days free, then %{price}. Cancel any time.`
- **code** — the billed amount at least as prominent as the trial offer
- **code** — working links to Terms of Use and Privacy Policy
- **code** — Restore Purchases, on the paywall itself and in Settings
- **you** — the same Terms of Use in App Store Connect → App Information →
  License Agreement (or Apple's standard EULA), and the Privacy Policy URL field

The trial is only promised when the store reports a genuinely free introductory
phase _and_, on iOS, confirms this Apple ID may still take it — headline,
price line, button and legal text all follow the same flag. Apple grants one
introductory offer per subscription group per Apple ID, so promising it
unconditionally is a rejection risk, and a paid introductory offer is not a
free trial either.

The billing disclosure is branched by platform: the Apple ID and App Store
settings on iOS, the Google Play account and its subscription settings on
Android.

---

## 3. Account and sign-in

- **code** — Sign in with Apple is offered alongside Google (Guideline 4.8),
  using Apple's own `AppleAuthenticationButton` rather than a themed lookalike
- **code** — account deletion happens in the app, deletes rather than
  deactivates, and revokes the Apple sign-in grant (Guideline 5.1.1(v))
- **you** — set `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` for the edge functions,
  or deletion cannot revoke the grant. See
  [BACKEND_SETUP.md](./BACKEND_SETUP.md#5-sign-in-with-apple-revocation)

---

## 4. Privacy

- **code** — `app.json` declares `NSPrivacyTracking: false` and the required-reason
  API entries (UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1,
  DiskSpace E174.1). Expo only emits `PrivacyInfo.xcprivacy` when
  `ios.privacyManifests` is present, so this key must stay.
- **code** — no ATT prompt: PostHog runs without IDFA, so nothing here is
  "tracking" under Apple's definition
- **you** — App Privacy answers in App Store Connect. What the app actually
  collects, which is also what `NSPrivacyCollectedDataTypes` declares: a name and
  an email address (through Apple/Google sign-in, linked to the user), the user
  id, product interaction and diagnostics (PostHog, linked to the user id), and
  learner-written explanations (sent to the AI grader, stored in `ai_reviews`).
  The provider's avatar URL is deliberately not collected.

---

## 5. Assets

- **code** — `npm run icon:build` renders the icon at 1024×1024, opaque, with the
  alpha channel stripped and no rounded corners baked in, plus dark and tinted
  variants and the Android adaptive foreground
- **code** — `supportsTablet: false`, so no iPad screenshots or iPad layout work
  is owed. Flip it only if you are ready to ship both.
- **you** — screenshots (6.7" and 6.5" at minimum), the App Store description,
  keywords, support URL and marketing URL

---

## 6. Build and submit

```bash
# one-time
npx eas login
npx eas build:configure

# a build you can install on a device to test purchases
npx eas build --profile development --platform ios

# release candidate
npx eas build --profile production --platform ios
npx eas submit --profile production --platform ios
```

`eas.json` sets `appVersionSource: "remote"` with `autoIncrement` on the
production profile, which is why `app.json` carries no `buildNumber` — two
sources of truth there make submissions fail on a duplicate `CFBundleVersion`.

RevenueCat needs a real build: it is a native module with no Expo config plugin,
so purchases cannot be tested in Expo Go. On a simulator without a StoreKit
configuration the offering comes back empty and the paywall shows its
"store unavailable" state, which is correct behaviour rather than a bug.

---

## 7. Notes for the reviewer

Add these to App Store Connect → App Review Information → Notes:

- The 3-day free trial is an App Store introductory offer; the paywall shows the
  renewal price alongside it.
- AI feedback on the "explain this code" question is the paid feature. Reviewers
  can see the free state (the question, an explanation of what it does, and a
  skip) without subscribing.
- Account deletion is in Settings → Account → Delete account, and is immediate.

A demo account is not required — sign-in is Apple/Google only, and a reviewer
can use their own Apple ID — but if you provide one, note that it will not have
an active subscription unless you grant it one in RevenueCat.

---

## 8. Before every release

```bash
npm run typecheck
npm test
npm run content:check     # runs every code snippet in the question bank
npm run expo:doctor
```

If the question bank changed, also:

```bash
npm run content:seed && npm run supabase:push
```

otherwise the AI grader will not have rubrics for the new questions.
