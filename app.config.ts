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
  return {
    ...baseConfig,
    // Merge any dynamic config from the default config context
    ...config,
    // Ensure the name and slug are always set from app.json
    name: baseConfig.name,
    slug: baseConfig.slug,
    // Extra field for runtime environment variables if needed
    extra: {
      ...config.extra,
      eas: {
        projectId: process.env.EAS_PROJECT_ID,
      },
    },
  };
};
