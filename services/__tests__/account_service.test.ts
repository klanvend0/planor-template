/**
 * Deleting an account, which App Store Review 5.1.1(v) requires to work from
 * inside the app.
 *
 * The two builds delete different things — the demo build wipes the device's
 * own copy, a configured build calls the edge function that holds the service
 * role key — and both have to end with the learner signed out. A delete that
 * leaves the session behind puts them straight back into an account that no
 * longer exists.
 */

const mockInvoke = jest.fn();
const mockSignOut = jest.fn();
const mockLocalDelete = jest.fn();
const mockClearAuth = jest.fn();

// `mock`-prefixed so the hoisted factory may close over it: which backend the
// app is on is decided at import time, and both branches need exercising.
const mockBackendMode = { local: false };

jest.mock('@/lib/backend_mode', () => ({
  get USES_LOCAL_BACKEND() {
    return mockBackendMode.local;
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    auth: { signOut: () => mockSignOut() },
  },
}));

jest.mock('@/services/local/backend', () => ({ deleteAccount: () => mockLocalDelete() }));
jest.mock('@/stores/auth_store', () => ({
  useAuthStore: { getState: () => ({ clearAuth: mockClearAuth }) },
}));

const { FunctionsHttpError } = jest.requireActual('@supabase/supabase-js');

import { deleteAccount } from '@/services/account_service';

beforeEach(() => {
  jest.clearAllMocks();
  mockBackendMode.local = false;
  mockInvoke.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
  mockLocalDelete.mockResolvedValue(undefined);
});

it('asks the edge function, then drops the session', async () => {
  await deleteAccount();

  expect(mockInvoke).toHaveBeenCalledWith('delete-account', { body: {} });
  expect(mockSignOut).toHaveBeenCalled();
});

it('keeps the session when the server refused, so nothing looks deleted that is not', async () => {
  mockInvoke.mockResolvedValue({ error: new Error('boom') });

  await expect(deleteAccount()).rejects.toMatchObject({ code: 'unknown' });
  expect(mockSignOut).not.toHaveBeenCalled();
});

it('says an expired session is an expired session', async () => {
  mockInvoke.mockResolvedValue({
    error: new FunctionsHttpError({ status: 401, json: async () => ({ error: 'unauthorized' }) }),
  });

  await expect(deleteAccount()).rejects.toMatchObject({ code: 'auth' });
});

it('wipes the device copy and forgets who was signed in, on the demo build', async () => {
  mockBackendMode.local = true;

  await deleteAccount();

  expect(mockLocalDelete).toHaveBeenCalled();
  // The local id is minted from a constant, so a session left behind would sign
  // back in to the same id — with the deleted XP and streak back on screen.
  expect(mockClearAuth).toHaveBeenCalled();
  expect(mockInvoke).not.toHaveBeenCalled();
});
