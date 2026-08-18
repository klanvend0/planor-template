/**
 * External links.
 *
 * Legal pages open in an in-app browser so the learner never leaves the app
 * (and, on iOS, so the reviewer can reach the Terms and Privacy Policy from the
 * paywall without a context switch). `mailto:` and App Store links have to go to
 * the system handler instead.
 *
 * @module lib/links
 */

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

/**
 * Open a URL.
 *
 * @param url - Absolute URL. `http(s)` opens in the in-app browser; anything
 * else (mailto:, itms-apps:, ...) is handed to the system.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
      return;
    }
    await Linking.openURL(url);
  } catch (error) {
    console.warn('[links] could not open', url, error);
  }
}
