/**
 * Jest configuration.
 *
 * The transform ignore list has to name every package that ships untranspiled
 * ESM; jest-expo's preset handles the Expo ones, the rest are added here.
 */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@rn-primitives|expo-modules-core|react-native-purchases|@revenuecat/.*|nativewind|react-native-css-interop)',
  ],
};
