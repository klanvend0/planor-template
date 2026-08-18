# Shipping to the App Store

What has to be true before the first submission, and what the build commands are.
Everything marked **code** is already handled in the repo; everything marked
**you** needs a real account, a real page, or a real decision.

---

## 1. Placeholders to replace

| Where | Key | Currently |
| --- | --- | --- |
| `app.json` | `expo.ios.bundleIdentifier` | `com.planor.codeling` |
| `app.json` | `expo.ios.appleTeamId` | `__APPLE_TEAM_ID__` |
| `eas.json` | `submit.production.ios.appleId` | `__APPLE_ID_EMAIL__` |
| `eas.json` | `submit.production.ios.ascAppId` | `__APP_STORE_CONNECT_APP_ID__` |
| `.env` | `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_PRIVACY_URL` | codeling.app placeholders |
| `.env` | `EXPO_PUBLIC_APP_STORE_ID` | empty (fill in after the first submit) |

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

The trial is only promised when RevenueCat confirms the learner is eligible.
Apple grants one introductory offer per subscription group per Apple ID, so
promising it unconditionally is a rejection risk.

---

## 3. Account and sign-in

- **code** — Sign in with Apple is offered alongside Google (Guideline 4.8)
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
  collects: an email address (through Apple/Google sign-in, linked to the user),
  product interaction and diagnostics (PostHog, linked to the user id), and
  learner-written explanations (sent to the AI grader, stored in `ai_reviews`).

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
