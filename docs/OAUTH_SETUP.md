# OAuth Setup Guide

This guide explains how to configure Google Sign-In and Apple Sign-In for your app. Follow each step carefully.

## Prerequisites

Before starting, ensure you have:

1. A Supabase project with Auth enabled
2. Access to [Google Cloud Console](https://console.cloud.google.com/) (for Google Sign-In)
3. Access to [Apple Developer Portal](https://developer.apple.com/) (for Apple Sign-In, requires $99/year membership)

---

## Google Sign-In Setup

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API** or **Google Identity Services**

### Step 2: Configure OAuth Consent Screen

1. Navigate to **APIs & Services > OAuth consent screen**
2. Choose **External** user type
3. Fill in the required fields:
   - App name: Your app name
   - User support email: Your email
   - Developer contact information: Your email
4. Add scopes: `email`, `profile`, `openid`
5. Add test users if in testing mode
6. Click **Save and Continue**

### Step 3: Create OAuth 2.0 Client ID

1. Navigate to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Select **Web Application**
4. Fill in:
   - **Name**: `Your App Name`
   - **Authorized JavaScript origins**: `https://<your-project-ref>.supabase.co`
   - **Authorized redirect URIs**: `https://<your-project-ref>.supabase.co/auth/v1/callback`
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

> **Note:** Find your `<your-project-ref>` in your Supabase Dashboard URL (e.g., `abcdefghijkl` from `https://abcdefghijkl.supabase.co`)

### Step 4: Configure Supabase Google Provider

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Authentication > Providers**
4. Find **Google** and click to enable
5. Enter your **Client ID** and **Client Secret** from Step 3
6. Click **Save**

### Step 5: Configure Supabase Redirect URLs

1. Go to **Authentication > URL Configuration**
2. Set **Site URL** to: `__APP_SLUG__://`
3. Add to **Redirect URLs**:
   - `__APP_SLUG__://auth/callback`
4. Click **Save**

---

## Apple Sign-In Setup (iOS Only)

> **Note:** Apple Sign-In works natively on iOS devices only. Android users will not see the Apple Sign-In button.

### Step 1: Create App ID with Sign In with Apple

1. Go to [Apple Developer Portal](https://developer.apple.com/)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Select **Identifiers** from the sidebar
4. Click **+** to create a new identifier
5. Select **App IDs** and click **Continue**
6. Select **App** and click **Continue**
7. Fill in:
   - **Description**: Your app name
   - **Bundle ID**: `__BUNDLE_ID__` (Explicit)
8. Scroll down to **Capabilities**
9. Check ✅ **Sign In with Apple**
10. Click **Continue**, then **Register**

### Step 2: Create a Key for Apple Sign-In

1. Go to **Keys** in the sidebar
2. Click **+** to create a new key
3. Fill in:
   - **Key Name**: `Your App Sign-In Key`
4. Check ✅ **Sign In with Apple**
5. Click **Configure** next to Sign In with Apple
6. Select your **Primary App ID** (the one you created in Step 1)
7. Click **Save**, then **Continue**, then **Register**
8. **Download** the key file (`.p8`) - you can only download it once!
9. Note the **Key ID** shown on the page

### Step 3: Generate Apple Client Secret

Apple requires a JWT client secret for OAuth. Use the provided script:

```bash
npm run generate:apple-secret
```

The script will ask for:

- **Team ID**: Found in Apple Developer Portal (top right, under your name)
- **Key ID**: From Step 2
- **Service ID**: Your bundle ID (e.g., `__BUNDLE_ID__`)
- **Path to .p8 file**: The key file you downloaded

Copy the generated secret for the next step.

### Step 4: Configure Supabase Apple Provider

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **Authentication > Providers**
3. Find **Apple** and click to enable
4. Fill in:
   - **Client IDs**: `__BUNDLE_ID__`
   - **Secret Key**: Paste the JWT secret from Step 3
5. Click **Save**

### Step 5: Configure app.json

Open `app.json` and ensure these values are set:

```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "__BUNDLE_ID__",
      "usesAppleSignIn": true,
      "appleTeamId": "__APPLE_TEAM_ID__"
    }
  }
}
```

### Step 6: Build for iOS

Apple Sign-In requires a development build (not Expo Go):

```bash
npx expo prebuild
npx expo run:ios --device
```

---

## Testing

### iOS Testing

```bash
# Simulator (Google Sign-In works, Apple Sign-In may not)
npx expo run:ios

# Physical device (required for Apple Sign-In)
npx expo run:ios --device
```

### Android Testing

```bash
npx expo run:android
```

> **Note:** Apple Sign-In button will not appear on Android.

---

## Troubleshooting

### Google Sign-In Issues

| Error                         | Solution                                      |
| ----------------------------- | --------------------------------------------- |
| Invalid Client ID             | Verify Client ID matches Google Cloud Console |
| Redirect URI mismatch         | Check Supabase redirect URLs match exactly    |
| Sign-in cancelled immediately | Check Supabase URL Configuration              |

### Apple Sign-In Issues

| Error                | Solution                                                         |
| -------------------- | ---------------------------------------------------------------- |
| Authorization failed | Run on physical device, not simulator                            |
| Invalid client_id    | Verify Bundle ID matches Apple Developer Portal                  |
| Secret key expired   | Regenerate with `npm run generate:apple-secret` (every 6 months) |

---

## Usage Example

```tsx
import { Alert, View, Platform } from 'react-native';
import { router } from 'expo-router';
import { AppleSignInButton, GoogleSignInButton } from '@/components/auth';

function LoginScreen() {
  const handleSuccess = () => {
    router.replace('/(protected)');
  };

  const handleError = (error: string) => {
    Alert.alert('Sign-In Error', error);
  };

  return (
    <View>
      <GoogleSignInButton onSuccess={handleSuccess} onError={handleError} />
      {Platform.OS === 'ios' && (
        <AppleSignInButton onSuccess={handleSuccess} onError={handleError} />
      )}
    </View>
  );
}
```

---

## Security Checklist

- [ ] Never commit `.env` files with real credentials
- [ ] Enable **Row Level Security (RLS)** on all Supabase tables
- [ ] Regenerate Apple secret before it expires (every 6 months)
- [ ] Rotate keys if compromised

---

## Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Expo Apple Authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Apple Sign-In Documentation](https://developer.apple.com/sign-in-with-apple/)
