/**
 * Expo configuration file that extends app.json with environment variable support.
 * This enables .env files to work correctly with EAS Build (--local) and production builds.
 *
 * Environment variables prefixed with EXPO_PUBLIC_ are automatically available
 * in the app via process.env.EXPO_PUBLIC_*.
 */

import { ExpoConfig, ConfigContext } from 'expo/config';

// Import the static app.json configuration
import appJson from './app.json';

// Type assertion to ensure orientation is correctly typed
const baseConfig = appJson.expo as ExpoConfig;

/**
 * Refuse to build something that cannot work.
 *
 * With no Supabase credentials the app runs on the device, which is right for a
 * clone and wrong for the App Store — and a *placeholder* URL is worse than
 * none, because it looks configured and every request fails. `eas env:list`
 * cannot catch this (a build profile's own `env` would win over it), so the
 * check runs here, on the builder, where the resolved values actually are.
 */
function assertShippable(): void {
  if (process.env.EAS_BUILD !== 'true' || process.env.EAS_BUILD_PROFILE !== 'production') return;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
  const placeholder = url.includes('your-project') || key.includes('your-anon');

  if (!url || !key || placeholder) {
    throw new Error(
      'A production build needs real EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_KEY values. Set them in the EAS "production" ' +
        'environment (`eas env:create --environment production`) and do not put ' +
        'them in eas.json, whose build-profile env would override them. Without ' +
        'them the app runs entirely on the device and gives away Pro.'
    );
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  assertShippable();

  // `eas init` writes the project id into app.json's extra.eas. Only override it
  // when an id is explicitly provided, or a build would blank the linked one.
  const projectId = process.env.EAS_PROJECT_ID;

  // The two values that are specific to whoever ships this app. They live in
  // the environment rather than in app.json so that setting up a real build is
  // a `.env` change like everything else, not a diff against the repo.
  const bundleIdentifier = process.env.IOS_BUNDLE_ID || baseConfig.ios?.bundleIdentifier;
  const appleTeamId = process.env.APPLE_TEAM_ID || baseConfig.ios?.appleTeamId;

  return {
    ...baseConfig,
    // Merge any dynamic config from the default config context
    ...config,
    // Ensure the name and slug are always set from app.json
    name: baseConfig.name,
    slug: baseConfig.slug,
    ios: {
      ...baseConfig.ios,
      ...config.ios,
      bundleIdentifier,
      appleTeamId,
    },
    extra: {
      ...baseConfig.extra,
      ...config.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
