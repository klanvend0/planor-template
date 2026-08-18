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

export default ({ config }: ConfigContext): ExpoConfig => {
  // `eas init` writes the project id into app.json's extra.eas. Only override it
  // when an id is explicitly provided, or a build would blank the linked one.
  const projectId = process.env.EAS_PROJECT_ID;

  return {
    ...baseConfig,
    // Merge any dynamic config from the default config context
    ...config,
    // Ensure the name and slug are always set from app.json
    name: baseConfig.name,
    slug: baseConfig.slug,
    extra: {
      ...baseConfig.extra,
      ...config.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
