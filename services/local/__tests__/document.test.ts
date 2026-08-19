/**
 * The only copy.
 *
 * With no `.env` this document is the learner's entire save, so the cases that
 * matter are the ones where storage misbehaves: a read that fails, and bytes
 * that will not parse. Neither may quietly become "you have no progress".
 *
 * Each case re-imports the module the way a relaunch would, against a storage
 * mock that outlives the module registry.
 */

const mockStore = new Map<string, string>();
let mockReadFails = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => {
      if (mockReadFails) throw new Error('storage unavailable');
      return mockStore.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));

const KEY = 'codeling.local-backend.v1';

type DocumentModule = typeof import('@/services/local/document');

/** Load the module as a cold start would, with storage as it stands. */
async function relaunch<T>(use: (module: DocumentModule) => Promise<T>): Promise<T> {
  let result!: T;
  await jest.isolateModulesAsync(async () => {
    const module = require('@/services/local/document') as DocumentModule;
    result = await use(module);
  });
  return result;
}

beforeEach(() => {
  mockStore.clear();
  mockReadFails = false;
});

describe('the local document', () => {
  it('is there again after a relaunch', async () => {
    await relaunch(async ({ mutateDocument }) => {
      await mutateDocument((document) => {
        document.game.totalXp = 120;
      });
    });

    expect(await relaunch(async ({ readDocument }) => (await readDocument()).game.totalXp)).toBe(
      120
    );
  });

  it('refuses to write over a save it could not read', async () => {
    await relaunch(async ({ mutateDocument }) => {
      await mutateDocument((document) => {
        document.game.totalXp = 250;
      });
    });

    mockReadFails = true;
    await relaunch(async ({ readDocument, mutateDocument }) => {
      // The read hands back a blank stand-in rather than throwing at the screen…
      expect((await readDocument()).game.totalXp).toBe(0);
      // …but nothing may persist it over the save that is merely unreadable.
      await expect(
        mutateDocument((document) => {
          document.game.totalXp = 0;
        })
      ).rejects.toThrow(/unreadable/);
    });

    // Once storage answers again, the save is still there.
    mockReadFails = false;
    expect(await relaunch(async ({ readDocument }) => (await readDocument()).game.totalXp)).toBe(
      250
    );
  });

  it('sets bytes it cannot parse aside instead of dropping them', async () => {
    mockStore.set(KEY, '{ not json');

    const total = await relaunch(async ({ readDocument }) => (await readDocument()).game.totalXp);

    expect(total).toBe(0);
    expect(mockStore.get(`${KEY}.unreadable`)).toBe('{ not json');
  });

  it('fills in fields a document written by an older build did not have', async () => {
    mockStore.set(KEY, JSON.stringify({ version: 1, game: { totalXp: 40 } }));

    const document = await relaunch(async ({ readDocument }) => readDocument());

    expect(document.game.totalXp).toBe(40);
    expect(document.lessons).toEqual({});
    expect(document.attempts).toEqual([]);
    expect(document.profile.locale).toBe('en');
  });

  it('starts fresh on a document from a version it does not know', async () => {
    mockStore.set(KEY, JSON.stringify({ version: 99, game: { totalXp: 40 } }));

    expect(await relaunch(async ({ readDocument }) => (await readDocument()).game.totalXp)).toBe(0);
  });
});
