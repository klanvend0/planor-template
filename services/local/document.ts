/**
 * The device-local database.
 *
 * One JSON document in AsyncStorage standing in for the seven Postgres tables
 * the app would otherwise use. It is deliberately a single document rather than
 * a table-per-key: every write in this app touches game state and one other
 * thing at once, and a single document makes that atomic without a transaction.
 *
 * Everything here is private to {@link services/local/backend}.
 *
 * @module services/local/document
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CourseId } from '@/lib/content_schema';
import { MAX_HEARTS } from '@/lib/gamification';
import type { SupportedLocale } from '@/lib/i18n';
import type { ExplanationVerdict } from '@/services/grading_service';
import type { LessonProgress } from '@/services/progress_service';

const STORAGE_KEY = 'codeling.local-backend.v1';

/** Attempts are kept for the mistakes deck, so the tail can be dropped. */
const MAX_ATTEMPTS = 600;
/** XP events older than this are only summed for "this week". */
const MAX_XP_EVENTS = 400;

export type XpSource = 'lesson' | 'perfect_bonus' | 'streak_bonus' | 'practice' | 'ai_review';

export type LocalGameState = {
  totalXp: number;
  hearts: number;
  heartsUpdatedAt: string;
  streakDays: number;
  longestStreak: number;
  lastActiveDate: string | null;
  streakFreezes: number;
  lessonsCompleted: number;
  perfectLessons: number;
  lastFreeRefillAt: string | null;
};

export type LocalAttempt = {
  questionId: string;
  lessonId: string;
  courseId: CourseId;
  isCorrect: boolean;
  at: string;
  /** The client's idempotency key; a replay with the same one is ignored. */
  attemptId?: string;
};

export type LocalXpEvent = {
  amount: number;
  source: XpSource;
  earnedOn: string;
};

/** Mirrors `public.profiles`, defaults included, so the shapes stay swappable. */
export type LocalProfile = {
  displayName: string | null;
  locale: SupportedLocale;
  activeCourse: CourseId;
  dailyGoalXp: number;
  reminderHour: number | null;
  onboardingCompleted: boolean;
  experienceLevel: 'new' | 'some' | 'confident';
};

export type LocalSubscription = {
  productId: string;
  /** ISO timestamp the period ends. */
  expiresAt: string;
  isTrial: boolean;
  willRenew: boolean;
};

export type LocalDocument = {
  version: 1;
  user: { id: string; createdAt: string } | null;
  /**
   * When this device first started keeping progress. Held outside `user`
   * because signing out clears who is playing but not what they have done —
   * and "learning since" is part of what they have done.
   */
  startedAt: string | null;
  profile: LocalProfile;
  game: LocalGameState;
  lessons: Record<string, LessonProgress>;
  attempts: LocalAttempt[];
  xpEvents: LocalXpEvent[];
  subscription: LocalSubscription | null;
  /** When the introductory offer was taken; the store allows it once. */
  trialUsedAt: string | null;
  aiReviews: { questionId: string; verdict: ExplanationVerdict; at: string }[];
};

export function emptyDocument(now: number = Date.now()): LocalDocument {
  return {
    version: 1,
    user: null,
    startedAt: null,
    profile: {
      displayName: null,
      locale: 'en',
      activeCourse: 'python',
      dailyGoalXp: 50,
      reminderHour: null,
      onboardingCompleted: false,
      experienceLevel: 'new',
    },
    game: {
      totalXp: 0,
      hearts: MAX_HEARTS,
      heartsUpdatedAt: new Date(now).toISOString(),
      streakDays: 0,
      longestStreak: 0,
      lastActiveDate: null,
      streakFreezes: 0,
      lessonsCompleted: 0,
      perfectLessons: 0,
      lastFreeRefillAt: null,
    },
    lessons: {},
    attempts: [],
    xpEvents: [],
    subscription: null,
    trialUsedAt: null,
    aiReviews: [],
  };
}

let cached: LocalDocument | null = null;
let loading: Promise<LocalDocument> | null = null;
let writing: Promise<void> = Promise.resolve();
/**
 * Set when storage could not be *read*, which is different from storage being
 * empty. While it is set nothing may be written: this document is the only copy
 * of the learner's progress, and persisting a blank stand-in over a save that
 * is merely unreadable right now would destroy it for good.
 */
let readFailed = false;

/**
 * Read the document, hydrating from storage the first time.
 *
 * Concurrent callers share one read: the lesson screen and the learn map both
 * ask for state on mount, and two parallel reads would race to seed an empty
 * document over each other.
 */
export async function readDocument(): Promise<LocalDocument> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    let raw: string | null = null;
    try {
      raw = await AsyncStorage.getItem(STORAGE_KEY);
      readFailed = false;
    } catch {
      // The read failed, not the data. Hand back a stand-in without caching it,
      // so the next call tries again rather than latching onto the blank.
      readFailed = true;
      loading = null;
      return emptyDocument();
    }

    try {
      const parsed = raw ? (JSON.parse(raw) as Partial<LocalDocument>) : null;
      // A document from a future version, or a corrupted one, is set aside
      // rather than half-read: a crash loop on every launch is worse, and the
      // bytes are kept under one fixed key so they can still be looked at.
      if (raw && !parsed) await AsyncStorage.setItem(`${STORAGE_KEY}.unreadable`, raw);
      cached = parsed?.version === 1 ? { ...emptyDocument(), ...parsed } : emptyDocument();
    } catch {
      if (raw) await AsyncStorage.setItem(`${STORAGE_KEY}.unreadable`, raw).catch(() => {});
      cached = emptyDocument();
    } finally {
      loading = null;
    }
    return cached!;
  })();

  return loading;
}

/**
 * Apply a change and persist it.
 *
 * Writes are serialized so two quick answers cannot interleave their reads and
 * writes, which is the local equivalent of the `for update` locks the RPCs take.
 */
export async function mutateDocument<T>(
  change: (document: LocalDocument) => T
): Promise<{ document: LocalDocument; result: T }> {
  const previous = writing;
  let release: () => void = () => {};
  writing = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    await previous;
    const document = await readDocument();
    if (readFailed) {
      // Writing now would put an empty document over a save that is only
      // temporarily unreadable.
      throw new Error('local storage is unreadable; refusing to write over it');
    }
    const result = change(document);

    document.attempts = document.attempts.slice(-MAX_ATTEMPTS);
    document.xpEvents = document.xpEvents.slice(-MAX_XP_EVENTS);
    cached = document;

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    return { document, result };
  } finally {
    release();
  }
}

/** Wipe everything. Used by account deletion and by tests. */
export async function resetDocument(): Promise<void> {
  await writing;
  cached = emptyDocument();
  readFailed = false;
  await AsyncStorage.removeItem(STORAGE_KEY);
}
