/**
 * Which backend the app is talking to.
 *
 * With Supabase credentials in `.env` the app is the real thing: accounts,
 * server-authoritative XP, the AI grader, RevenueCat. Without them it runs
 * entirely on the device — same screens, same rules, same content, but the
 * state lives in AsyncStorage and nothing leaves the phone. That is what makes
 * a fresh clone playable, and it is what the App Store build stops being the
 * moment a real `.env` is present.
 *
 * Everything keys off Supabase rather than off each service's own credentials:
 * a half-configured project (a real database but no RevenueCat key) has to
 * behave like the real app with a store outage, not like a demo that hands out
 * subscriptions.
 *
 * @module lib/backend_mode
 */

import { isSupabaseConfigured } from '@/lib/supabase';

/** True when there are no Supabase credentials, so the device is the backend. */
export const USES_LOCAL_BACKEND = !isSupabaseConfigured;
