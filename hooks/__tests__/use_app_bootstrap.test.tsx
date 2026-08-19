/**
 * The order the app starts up in.
 *
 * Two of these steps are the kind that only fail on a cold start with real data
 * on the device: deciding a learner is signed out before auth has answered, or
 * before the offline queue has been read off disk, throws away writes made
 * while they had no signal. The rest is about not repeating work — identifying
 * the same learner twice a second, rescheduling a reminder nobody asked for.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useAppBootstrap } from '@/hooks/use_app_bootstrap';

const mockInitI18n = jest.fn();
const mockScheduleReminder = jest.fn();
const mockIdentifyAnalytics = jest.fn();
const mockResetAnalytics = jest.fn();

const mockInitializeAuth = jest.fn();
const mockInitializeSubscription = jest.fn();
const mockIdentify = jest.fn();
const mockRefreshGame = jest.fn();
const mockClearGame = jest.fn();
const mockClearProgress = jest.fn();
const mockSetOwner = jest.fn();
const mockFlush = jest.fn();

/** The slice of each store this hook reads, rewritten per test. */
const mockWorld = {
  settings: { hydrated: true, remindersEnabled: false, reminderHour: 19 },
  auth: { isLoading: false, user: null as { id: string } | null },
  game: { state: { streakDays: 0 } as { streakDays: number } | null },
  queueHydrated: true,
  onFinishHydration: null as null | (() => void),
};

jest.mock('@/lib/i18n', () => ({ initI18n: () => mockInitI18n() }));
jest.mock('@/lib/analytics', () => ({
  identify: (...args: unknown[]) => mockIdentifyAnalytics(...args),
  resetAnalytics: () => mockResetAnalytics(),
}));
jest.mock('@/services/notifications_service', () => ({
  scheduleDailyReminder: (...args: unknown[]) => mockScheduleReminder(...args),
}));

jest.mock('@/stores/settings_store', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector(mockWorld.settings),
}));
jest.mock('@/stores/auth_store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ ...mockWorld.auth, initialize: mockInitializeAuth }),
}));
jest.mock('@/stores/subscription_store', () => ({
  useSubscriptionStore: (selector: (state: unknown) => unknown) =>
    selector({ initialize: mockInitializeSubscription, identify: mockIdentify }),
}));
jest.mock('@/stores/game_store', () => ({
  useGameStore: (selector: (state: unknown) => unknown) =>
    selector({ ...mockWorld.game, refresh: mockRefreshGame, clear: mockClearGame }),
}));
jest.mock('@/stores/progress_store', () => ({
  useProgressStore: (selector: (state: unknown) => unknown) =>
    selector({ clear: mockClearProgress }),
}));
jest.mock('@/stores/sync_queue', () => ({
  useSyncQueue: {
    getState: () => ({ setOwner: mockSetOwner, flush: mockFlush }),
    persist: {
      hasHydrated: () => mockWorld.queueHydrated,
      onFinishHydration: (callback: () => void) => {
        mockWorld.onFinishHydration = callback;
        return () => {
          mockWorld.onFinishHydration = null;
        };
      },
    },
  },
}));

/**
 * Render the hook and let the locale promise settle.
 *
 * `initI18n` resolves on a microtask, so without this the state it sets lands
 * after the test has moved on and React rightly complains.
 */
async function bootstrap() {
  const rendered = renderHook(() => useAppBootstrap());
  await act(async () => {});
  return rendered;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInitI18n.mockResolvedValue(undefined);
  mockRefreshGame.mockResolvedValue(undefined);
  mockIdentify.mockResolvedValue(undefined);
  mockFlush.mockResolvedValue(undefined);
  mockWorld.settings = { hydrated: true, remindersEnabled: false, reminderHour: 19 };
  mockWorld.auth = { isLoading: false, user: null };
  mockWorld.game = { state: { streakDays: 0 } };
  mockWorld.queueHydrated = true;
  mockWorld.onFinishHydration = null;
});

it('holds the splash until the locale, the preferences and the session are all in', async () => {
  mockWorld.settings.hydrated = false;
  mockWorld.auth.isLoading = true;

  const { result, rerender } = await bootstrap();
  expect(result.current.isReady).toBe(false);

  // The locale resolves on its own; the other two are still outstanding.
  await act(async () => {});
  expect(result.current.isReady).toBe(false);

  mockWorld.settings.hydrated = true;
  mockWorld.auth.isLoading = false;
  rerender({});
  expect(result.current.isReady).toBe(true);
});

it('starts the session and the store before anything is known about the learner', async () => {
  await bootstrap();

  expect(mockInitializeAuth).toHaveBeenCalled();
  expect(mockInitializeSubscription).toHaveBeenCalled();
});

it('decides nothing while auth is still answering', async () => {
  mockWorld.auth = { isLoading: true, user: null };

  await bootstrap();

  // Before auth answers, everyone looks signed out — clearing here would wipe a
  // signed-in learner's state on every cold start.
  expect(mockSetOwner).not.toHaveBeenCalled();
  expect(mockClearGame).not.toHaveBeenCalled();
});

it('waits for the offline queue to come off disk before touching its owner', async () => {
  mockWorld.queueHydrated = false;
  mockWorld.auth = { isLoading: false, user: { id: 'learner-1' } };

  const { rerender } = await bootstrap();

  // The queue's owner is on disk. Deciding before it is read would discard
  // whatever the learner did with no signal.
  expect(mockSetOwner).not.toHaveBeenCalled();

  act(() => mockWorld.onFinishHydration?.());
  rerender({});

  expect(mockSetOwner).toHaveBeenCalledWith('learner-1');
});

it('identifies a learner once, however often the app re-renders', async () => {
  mockWorld.auth = { isLoading: false, user: { id: 'learner-1' } };

  const { rerender } = await bootstrap();
  rerender({});
  rerender({});

  expect(mockIdentifyAnalytics).toHaveBeenCalledTimes(1);
  expect(mockIdentify).toHaveBeenCalledTimes(1);
  expect(mockRefreshGame).toHaveBeenCalledTimes(1);
});

it('hands the queue over and refreshes when a different learner signs in', async () => {
  mockWorld.auth = { isLoading: false, user: { id: 'learner-1' } };
  const { rerender } = await bootstrap();

  mockWorld.auth = { isLoading: false, user: { id: 'learner-2' } };
  rerender({});

  expect(mockSetOwner).toHaveBeenLastCalledWith('learner-2');
  expect(mockIdentify).toHaveBeenLastCalledWith('learner-2');
  expect(mockIdentify).toHaveBeenCalledTimes(2);
});

it('clears everything the moment a learner signs out', async () => {
  mockWorld.auth = { isLoading: false, user: { id: 'learner-1' } };
  const { rerender } = await bootstrap();

  mockWorld.auth = { isLoading: false, user: null };
  rerender({});

  // Whatever is still queued belonged to the account that just left.
  expect(mockSetOwner).toHaveBeenLastCalledWith(null);
  expect(mockResetAnalytics).toHaveBeenCalled();
  expect(mockClearGame).toHaveBeenCalled();
  expect(mockClearProgress).toHaveBeenCalled();
});

it('reschedules the reminder when the streak it talks about changes', async () => {
  mockWorld.settings = { hydrated: true, remindersEnabled: true, reminderHour: 20 };
  const { rerender } = await bootstrap();
  expect(mockScheduleReminder).toHaveBeenCalledWith(20, 0);

  mockWorld.game = { state: { streakDays: 3 } };
  rerender({});
  expect(mockScheduleReminder).toHaveBeenLastCalledWith(20, 3);
});

it('schedules nothing for a learner who turned reminders off', async () => {
  mockWorld.settings = { hydrated: true, remindersEnabled: false, reminderHour: 20 };

  await bootstrap();

  expect(mockScheduleReminder).not.toHaveBeenCalled();
});

describe('coming back to the foreground', () => {
  function foreground(status: 'active' | 'background' = 'active') {
    const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
    act(() => listener?.(status));
  }

  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  });

  it('lands the offline writes and refreshes quietly', async () => {
    mockWorld.auth = { isLoading: false, user: { id: 'learner-1' } };
    await bootstrap();
    mockRefreshGame.mockClear();

    foreground();

    expect(mockFlush).toHaveBeenCalled();
    // Silent: the learner is looking at a screen, not a spinner.
    expect(mockRefreshGame).toHaveBeenCalledWith({ silent: true });
  });

  it('does nothing for a learner who is not signed in, or for a backgrounding', async () => {
    await bootstrap();
    foreground();
    expect(mockFlush).not.toHaveBeenCalled();

    mockWorld.auth = { isLoading: false, user: { id: 'learner-1' } };
    const { rerender } = await bootstrap();
    rerender({});
    mockFlush.mockClear();

    foreground('background');
    expect(mockFlush).not.toHaveBeenCalled();
  });
});
