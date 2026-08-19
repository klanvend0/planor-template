/**
 * Which door each link goes through.
 *
 * Three destinations behave differently and the difference is not cosmetic: a
 * legal page should stay inside the app, `mailto:` has to reach the mail app,
 * and a store URL has to reach the store — an App Store page rendered inside an
 * in-app browser cannot cancel a subscription, which is the one thing the
 * learner tapped it for.
 */

import { Platform } from 'react-native';

const mockOpenBrowserAsync = jest.fn();
const mockOpenURL = jest.fn();

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));

jest.mock('expo-linking', () => ({ openURL: (...args: unknown[]) => mockOpenURL(...args) }));

import { openExternal, openStoreUrl } from '@/lib/links';

/** Pretend to be one platform. Replacing the whole module breaks the preset. */
function runningOn(os: 'ios' | 'android' | 'web') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  runningOn('ios');
  mockOpenBrowserAsync.mockResolvedValue(undefined);
  mockOpenURL.mockResolvedValue(undefined);
});

describe('an ordinary link', () => {
  it('keeps a web page inside the app', async () => {
    await openExternal('https://codeling.app/terms');

    expect(mockOpenBrowserAsync).toHaveBeenCalledWith('https://codeling.app/terms', {
      presentationStyle: 'pageSheet',
    });
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('hands anything else to the system', async () => {
    await openExternal('mailto:support@codeling.app');

    expect(mockOpenURL).toHaveBeenCalledWith('mailto:support@codeling.app');
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('says so and carries on when nothing can open it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenBrowserAsync.mockRejectedValue(new Error('no browser'));

    await expect(openExternal('https://codeling.app/terms')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('a store link', () => {
  it('goes to the system, which is what turns it into the store app', async () => {
    await openStoreUrl('https://apps.apple.com/account/subscriptions');

    expect(mockOpenURL).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });

  it('falls back to a web page rather than doing nothing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenURL.mockRejectedValue(new Error('no handler'));

    await openStoreUrl('https://play.google.com/store/account/subscriptions');

    expect(mockOpenBrowserAsync).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('opens a new tab on the web, where navigating would unload the app', async () => {
    runningOn('web');
    const open = jest.fn();
    (globalThis as { window?: unknown }).window = { open };

    await openStoreUrl('https://apps.apple.com/account/subscriptions');

    expect(open).toHaveBeenCalledWith(
      'https://apps.apple.com/account/subscriptions',
      '_blank',
      'noopener,noreferrer'
    );
    // Same tab would tear down every store, the session and any request in
    // flight — the learner would come back to a cold start.
    expect(mockOpenURL).not.toHaveBeenCalled();
    delete (globalThis as { window?: unknown }).window;
  });
});
