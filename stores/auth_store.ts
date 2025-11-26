/**
 * Authentication Store
 *
 * Zustand store for managing authentication state.
 * Syncs with Supabase Auth and provides reactive auth state
 * for protected routing and UI updates.
 *
 * @module stores/auth_store
 */

import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type AuthState = {
  /** Current Supabase session, null if not authenticated */
  session: Session | null;
  /** Current authenticated user, null if not authenticated */
  user: User | null;
  /** Whether auth state is being loaded */
  isLoading: boolean;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
};

type AuthActions = {
  /** Initialize auth state and set up listener */
  initialize: () => Promise<void>;
  /** Set session and user state */
  setSession: (session: Session | null) => void;
  /** Clear auth state on sign out */
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  session: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    try {
      // Get initial session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      set({
        session,
        user: session?.user ?? null,
        isAuthenticated: !!session,
        isLoading: false,
      });

      // Listen for auth state changes
      supabase.auth.onAuthStateChange((_event, session) => {
        console.log('Auth state changed:', _event, session?.user?.email);
        set({
          session,
          user: session?.user ?? null,
          isAuthenticated: !!session,
        });
      });
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({ isLoading: false });
    }
  },

  setSession: (session) => {
    set({
      session,
      user: session?.user ?? null,
      isAuthenticated: !!session,
    });
  },

  clearAuth: () => {
    set({
      session: null,
      user: null,
      isAuthenticated: false,
    });
  },
}));
