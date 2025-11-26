# Planor App Template

A production-ready React Native / Expo template built for speed and scalability.

## Features

- **Framework**: [Expo SDK 54](https://expo.dev/) (React Native 0.81)
- **Navigation**: [Expo Router](https://expo.dev/router)
- **Styling**: [NativeWind](https://www.nativewind.dev/) (Tailwind CSS) + [React Native Reusables](https://reactnativereusables.com)
- **Backend**: [Supabase](https://supabase.com/) (Auth, Database, Edge Functions)
- **Internationalization**: [i18n-js](https://github.com/fnando/i18n-js) + [expo-localization](https://docs.expo.dev/versions/latest/sdk/localization/)
- **Analytics**: [PostHog](https://posthog.com/)
- **Paywalls**: [Superwall](https://superwall.com/)
- **Testing**: [Jest](https://jestjs.io/) + [React Native Testing Library](https://callstack.github.io/react-native-testing-library/)

## Getting Started

### 1. Create a New App

Use this template on GitHub or clone it:

```bash
# Using GitHub template (recommended)
# Click "Use this template" button on GitHub

# Or clone directly
git clone https://github.com/Planor-Dev/planor-template.git my-app
cd my-app
rm -rf .git && git init
```

### 2. Environment Setup

Fill in your API keys in `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=your-anon-key
EXPO_PUBLIC_POSTHOG_API_KEY=your-posthog-key
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
EXPO_PUBLIC_SUPERWALL_API_KEY=your-superwall-key
```

### 3. Supabase Setup

Link to your remote Supabase project:

```bash
npm run supabase:login     # Login to Supabase CLI
npm run supabase:link      # Link to your project
npm run supabase:pull      # Pull existing schema (optional)
npm run supabase:gen-types # Generate TypeScript types
```

### 4. Run the App

```bash
npm install
npm run dev
# or
npm run ios
# or
npm run android
```

## Supabase Development Workflow

This template uses Supabase CLI for migrations:

```bash
# Create a new migration
npm run supabase:migration:new my_migration_name

# Edit the migration file in supabase/migrations/

# Push migrations to remote Supabase
npm run supabase:push

# Regenerate TypeScript types
npm run supabase:gen-types
```

Migration files are stored in `supabase/migrations/` and TypeScript types are generated to `lib/database.types.ts`.

## Project Structure

- `app/`: Expo Router pages and layouts
- `components/`: Reusable UI components
- `lib/`: Service configurations (Supabase, i18n, PostHog, etc.)
- `i18n/`: Translation files
- `supabase/`: Supabase config and migrations
- `scripts/`: Setup and utility scripts

## Testing

Run the test suite with:

```bash
npm test
```
