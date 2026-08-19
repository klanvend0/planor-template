/**
 * Who is playing.
 *
 * The app needs four things about a learner — an id to key their data on, a
 * name to greet them by, an address to show in settings, and the day they
 * started — so that is what this store holds, rather than Supabase's `User`.
 * Two things supply it: a Supabase session when the project is configured, and
 * the device itself when it is not. Screens do not know which.
 *
 * @module stores/auth_store
 */

import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { USES_LOCAL_BACKEND } from '@/lib/backend_mode';
import { supabase } from '@/lib/supabase';
import * as local from '@/services/local/backend';

/** The learner, from whichever backend knows about them. */
export type AppUser = {
  id: string;
  email: string | null;
  /** From the identity provider, when it gave one. */
  fullName: string | null;
  /** ISO timestamp, shown on the profile as "learning since". */
  createdAt: string | null;
};

function fromSupabase(user: User): AppUser {
  const metadata = user.user_metadata as { full_name?: string; name?: string } | null;
  return {
    id: user.id,
    email: user.email ?? null,
    fullName: metadata?.full_name ?? metadata?.name ?? null,
    createdAt: user.created_at ?? null,
  };
}

type AuthState = {
  /** The Supabase session, or null in local mode and while signed out. */
  session: Session | null;
  user: AppUser | null;
  /** True until the first answer about who is signed in. */
  isLoading: boolean;
  isAuthenticated: boolean;
};

type AuthActions = {
  /** Restore whoever was signed in, and follow changes. */
  initialize: () => Promise<void>;
  setSession: (session: Session | null) => void;
  /**
   * Start playing on this device, with no account behind it. Only reachable
   * when there is no Supabase project to sign in to.
   */
  startLocalSession: () => Promise<void>;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  session: null,
  user: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    if (USES_LOCAL_BACKEND) {
      const learner = await local.currentUser();
      set({
        session: null,
        user: learner
          ? { id: learner.id, email: null, fullName: null, createdAt: learner.createdAt }
          : null,
        isAuthenticated: !!learner,
        isLoading: false,
      });
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      set({
        session,
        user: session?.user ? fromSupabase(session.user) : null,
        isAuthenticated: !!session,
        isLoading: false,
      });

      supabase.auth.onAuthStateChange((_event, next) => {
        set({
          session: next,
          user: next?.user ? fromSupabase(next.user) : null,
          isAuthenticated: !!next,
        });
      });
    } catch (error) {
      // A learner who cannot be identified is sent to sign-in, not stranded on
      // the splash screen.
      console.warn('[auth] could not restore the session', error);
      set({ isLoading: false });
    }
  },

  setSession: (session) =>
    set({
      session,
      user: session?.user ? fromSupabase(session.user) : null,
      isAuthenticated: !!session,
    }),

  startLocalSession: async () => {
    const learner = await local.signIn();
    set({
      session: null,
      user: { id: learner.id, email: null, fullName: null, createdAt: learner.createdAt },
      isAuthenticated: true,
      isLoading: false,
    });
  },

  clearAuth: () => set({ session: null, user: null, isAuthenticated: false }),
}));
