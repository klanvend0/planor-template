# OAuth Setup Guide

This guide explains how to configure Google Sign-In and Apple Sign-In for your Planor app.

## Prerequisites

Before setting up OAuth, ensure you have:

1. A Supabase project with Auth enabled
2. Access to Google Cloud Console (for Google Sign-In)
3. Access to Apple Developer Portal (for Apple Sign-In)

---

## Google Sign-In Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API** or **Google Identity Services**

### 2. Configure OAuth Consent Screen

1. Navigate to **APIs & Services > OAuth consent screen**
2. Choose **External** user type (or Internal for G Suite)
3. Fill in the required fields:
   - App name
   - User support email
   - Developer contact information
4. Add scopes: `email`, `profile`, `openid`
5. Add test users if in testing mode

### 3. Create OAuth 2.0 Client ID

1. Navigate to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Select **Web Application**:
   - Name: `Planor App`
   - Authorized JavaScript origins:
     - `https://<your-project-ref>.supabase.co`
   - Authorized redirect URIs:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client Secret**

> **Note:** Replace `<your-project-ref>` with your Supabase project reference (found in your Supabase dashboard URL).

### 4. Configure Supabase

1. Go to your Supabase Dashboard
2. Navigate to **Authentication > Providers**
3. Enable **Google**
4. Add your **Google Client ID** and **Client Secret**
5. Save the configuration

### 5. Configure Supabase Redirect URLs

1. Go to **Authentication > URL Configuration**
2. Set **Site URL** to: `planor-template://`
3. Add to **Redirect URLs**:
   - `planor-template://auth/callback`
   - `planor-template://**` (wildcard for flexibility)

---

## Apple Sign-In Setup

### 1. Apple Developer Account Requirements

- Active Apple Developer Program membership ($99/year)
- Access to [Apple Developer Portal](https://developer.apple.com/)

### 2. Enable Sign In with Apple

1. Go to **Certificates, Identifiers & Profiles**
2. Select **Identifiers**
3. Select your App ID or create one
4. Enable **Sign In with Apple** capability
5. Configure the capability:
   - Enable as Primary App ID
   - Configure domains and return URLs (for web)

### 3. Create a Service ID (for Android/Web support)

1. Go to **Identifiers > Service IDs**
2. Click **+** to create a new Service ID
3. Fill in:
   - Description: `Planor App Sign-In`
   - Identifier: `com.planor.template.signin` (example)
4. Enable **Sign In with Apple**
5. Configure:
   - Domains: Your Supabase project URL domain
   - Return URLs: `https://your-project.supabase.co/auth/v1/callback`

### 4. Create a Key for Apple Sign-In

1. Go to **Keys**
2. Click **+** to create a new key
3. Name: `Planor App Sign-In Key`
4. Enable **Sign In with Apple**
5. Configure and download the key file (`.p8`)
6. Note the **Key ID**

### 5. Configure Supabase

1. Go to your Supabase Dashboard
2. Navigate to **Authentication > Providers**
3. Enable **Apple**
4. Add:
   - Service ID (from Service ID creation)
   - Secret Key (contents of `.p8` file)
   - Key ID (from key creation)
   - Team ID (from Apple Developer account)
5. Save the configuration

### 6. App Configuration (Already Done)

The `app.json` is already configured with:

```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "com.planor.template",
      "usesAppleSignIn": true
    },
    "plugins": ["expo-apple-authentication"]
  }
}
```

---

## URL Redirect Configuration

### Supabase Redirect URLs

1. Go to Supabase Dashboard > Authentication > URL Configuration
2. Set **Site URL** to: `planor-template://`
3. Add to **Redirect URLs**:
   - `planor-template://auth/callback`
   - `planor-template://**`

> **Important:** The deprecated `auth.expo.io` proxy is no longer recommended. Always use your app's custom URL scheme with Supabase's callback flow.

---

## Testing OAuth

### Development Testing

1. For iOS, run on a physical device or simulator:

   ```bash
   npx expo run:ios
   ```

2. For Android:

   ```bash
   npx expo run:android
   ```

3. For web with Google Sign-In:
   ```bash
   npx expo start --web
   ```

### Common Issues

#### Google Sign-In Issues

- **"idpiframe_initialization_failed"**: Clear browser cookies and cache
- **"popup_closed_by_user"**: Check redirect URIs match exactly
- **Invalid Client ID**: Verify the client ID is correct and has proper origins configured

#### Apple Sign-In Issues

- **"Invalid client_id"**: Verify Service ID matches Supabase configuration
- **"Invalid redirect_uri"**: Check redirect URLs in Apple Developer Portal
- **Only works on iOS**: Native Apple Sign-In requires iOS; use web flow for Android

---

## Usage

### Import Components

```tsx
import { AppleSignInButton, GoogleSignInButton } from '@/components/auth';
```

### Basic Usage

```tsx
import { Alert } from 'react-native';
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
      <AppleSignInButton onSuccess={handleSuccess} onError={handleError} />
    </View>
  );
}
```

### Using Auth Service Directly

```tsx
import { signInWithApple, signInWithGoogle, signOut } from '@/lib/auth';

// Google Sign-In (opens browser for OAuth)
const googleResult = await signInWithGoogle();
if (googleResult.success) {
  // Session will be handled by onAuthStateChange
}

// Apple Sign-In (iOS only, native flow)
const appleResult = await signInWithApple();
if (appleResult.success) {
  // Session will be handled by onAuthStateChange
}

// Sign Out
const logoutResult = await signOut();
```

---

## Security Considerations

1. **Never commit** `.env` files with real credentials
2. **Use HTTPS** for all redirect URLs in production
3. **Rotate keys** periodically, especially if compromised
4. **Enable RLS** (Row Level Security) on all Supabase tables
5. **Validate tokens** server-side when possible

---

## Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [Expo Apple Authentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
- [Expo Auth Session](https://docs.expo.dev/versions/latest/sdk/auth-session/)
- [Google OAuth Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Apple Sign-In Documentation](https://developer.apple.com/sign-in-with-apple/)
