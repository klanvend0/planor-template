/**
 * Postgres schema types.
 *
 * Hand-maintained to mirror `supabase/migrations/*.sql`. Regenerate with
 * `npm run supabase:gen-types` once the project is linked; until then this file
 * is the contract every service in `services/` types itself against.
 *
 * @module lib/database.types
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type CourseIdColumn = 'python' | 'javascript';
export type LocaleColumn = 'en' | 'tr';
export type SubscriptionStatus =
  'trialing' | 'active' | 'grace' | 'expired' | 'cancelled' | 'billing_issue' | 'paused';
export type XpSource =
  'lesson' | 'perfect_bonus' | 'streak_bonus' | 'daily_goal' | 'practice' | 'ai_review';
export type AiVerdict = 'correct' | 'partial' | 'incorrect';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          locale: LocaleColumn;
          active_course: CourseIdColumn;
          daily_goal_xp: number;
          reminder_hour: number | null;
          onboarding_completed: boolean;
          experience_level: 'new' | 'some' | 'confident';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          locale?: LocaleColumn;
          active_course?: CourseIdColumn;
          daily_goal_xp?: number;
          reminder_hour?: number | null;
          onboarding_completed?: boolean;
          experience_level?: 'new' | 'some' | 'confident';
        };
        Update: {
          display_name?: string | null;
          avatar_url?: string | null;
          locale?: LocaleColumn;
          active_course?: CourseIdColumn;
          daily_goal_xp?: number;
          reminder_hour?: number | null;
          onboarding_completed?: boolean;
          experience_level?: 'new' | 'some' | 'confident';
        };
        Relationships: [];
      };
      game_state: {
        Row: {
          user_id: string;
          total_xp: number;
          hearts: number;
          hearts_updated_at: string;
          streak_days: number;
          longest_streak: number;
          last_active_date: string | null;
          streak_freezes: number;
          lessons_completed: number;
          perfect_lessons: number;
          last_free_refill_at: string | null;
          updated_at: string;
        };
        Insert: { user_id: string };
        Update: never;
        Relationships: [];
      };
      lesson_progress: {
        Row: {
          user_id: string;
          lesson_id: string;
          course_id: CourseIdColumn;
          unit_id: string;
          status: 'in_progress' | 'completed';
          best_score: number;
          stars: number;
          attempts: number;
          xp_earned: number;
          first_completed_at: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      question_attempts: {
        Row: {
          id: number;
          user_id: string;
          question_id: string;
          lesson_id: string;
          course_id: CourseIdColumn;
          question_type: string;
          is_correct: boolean;
          answer: string | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      xp_events: {
        Row: {
          id: number;
          user_id: string;
          amount: number;
          source: XpSource;
          lesson_id: string | null;
          earned_on: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          user_id: string;
          rc_app_user_id: string | null;
          entitlement: string | null;
          product_id: string | null;
          store: string | null;
          status: SubscriptionStatus;
          is_active: boolean;
          period_type: string | null;
          current_period_end: string | null;
          trial_end: string | null;
          will_renew: boolean;
          environment: string | null;
          rc_event_id: string | null;
          last_event_at: string | null;
          updated_at: string;
          raw_event: Json | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      lesson_catalog: {
        Row: {
          lesson_id: string;
          unit_id: string;
          course_id: CourseIdColumn;
          question_count: number;
          base_xp: number;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_review_quota: {
        Row: {
          user_id: string;
          window_kind: 'hour' | 'day';
          window_start: string;
          used: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      apple_credentials: {
        Row: {
          user_id: string;
          refresh_token: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      question_rubrics: {
        Row: {
          question_id: string;
          course_id: CourseIdColumn;
          lesson_id: string;
          code_en: string;
          code_tr: string;
          key_points_en: Json;
          key_points_tr: Json;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ai_reviews: {
        Row: {
          id: number;
          user_id: string;
          question_id: string;
          locale: LocaleColumn;
          answer: string;
          verdict: AiVerdict;
          score: number;
          summary: string;
          corrections: Json;
          missed_points: Json;
          model: string | null;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      record_answer: {
        Args: {
          p_question_id: string;
          p_lesson_id: string;
          p_course_id: string;
          p_question_type: string;
          p_is_correct: boolean;
          p_answer?: string | null;
          p_duration_ms?: number | null;
          p_practice?: boolean;
        };
        Returns: { hearts_left: number; unlimited_hearts: boolean }[];
      };
      complete_lesson: {
        Args: {
          p_lesson_id: string;
          p_unit_id: string;
          p_course_id: string;
          p_correct: number;
          p_total: number;
          p_base_xp: number;
          p_played_on?: string | null;
        };
        Returns: {
          total_xp: number;
          xp_awarded: number;
          streak_days: number;
          hearts: number;
          stars: number;
          score: number;
          is_first_completion: boolean;
          daily_xp: number;
        }[];
      };
      get_game_state: {
        Args: Record<never, never>;
        Returns: {
          total_xp: number;
          hearts: number;
          hearts_updated_at: string;
          streak_days: number;
          longest_streak: number;
          last_active_date: string | null;
          streak_freezes: number;
          lessons_completed: number;
          perfect_lessons: number;
          daily_xp: number;
          weekly_xp: number;
          has_subscription: boolean;
        }[];
      };
      refill_hearts: {
        Args: Record<never, never>;
        Returns: number;
      };
      record_practice: {
        Args: { p_course_id: string; p_correct: number; p_total: number };
        Returns: { xp_awarded: number; total_xp: number; daily_xp: number }[];
      };
      get_mistake_questions: {
        Args: { p_course_id: string; p_limit?: number };
        Returns: { question_id: string; lesson_id: string; missed_at: string }[];
      };
      claim_ai_review: {
        Args: { p_user_id: string; p_hourly?: number; p_daily?: number };
        Returns: boolean;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
