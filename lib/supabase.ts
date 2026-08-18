/**
 * Supabase client.
 *
 * The single client every service shares. Sessions are persisted with
 * AsyncStorage rather than SecureStore: Supabase's tokens routinely exceed
 * SecureStore's 2048-byte limit, which fails silently and logs people out.
 *
 * @module lib/supabase
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto';

import { Database } from './database.types';

const AsyncStorageAdapter = {
  getItem: async (key: string) => AsyncStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    await AsyncStorage.removeItem(key);
  },
};

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

/** True when the project has real credentials; false in tests and fresh clones. */
export const isSupabaseConfigured = !!url && !!key;

if (!isSupabaseConfigured && __DEV__ && process.env.NODE_ENV !== 'test') {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY are missing — ' +
      'copy .env.example to .env. Requests will fail until they are set.'
  );
}

/**
 * A placeholder keeps `createClient` from throwing at import time when the app
 * is started without a `.env`; calls then fail as ordinary network errors, which
 * the UI already knows how to show.
 */
export const supabase = createClient<Database>(
  url ?? 'https://placeholder.supabase.co',
  key ?? 'placeholder-anon-key',
  {
    auth: {
      storage: AsyncStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

// Keep the session fresh only while the app is in the foreground, and stop the
// timer in the background so it does not wake the device.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
