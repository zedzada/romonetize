# Google OAuth Branding Setup

This guide fixes the Google login consent screen showing the Supabase project URL (`ccxyrhvumifactxmjzbe.supabase.co`) instead of RoMonetize branding.

## Issue

When users click "Sign in with Google", the consent screen shows:
```
Accéder à l'application ccxyrhvumifactxmjzbe.supabase.co
```

Instead of:
```
RoMonetize
```

## Solution

The branding shown on Google's OAuth consent screen is controlled by **Google Cloud Console**, not Supabase or the app code.

---

## Step 1: Update Google Cloud Console OAuth Consent Screen

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (the one with OAuth credentials for RoMonetize)
3. Navigate to **APIs & Services** → **OAuth consent screen**

### Update these fields:

| Field | Value |
|-------|-------|
| **App name** | `RoMonetize` |
| **User support email** | Your support email |
| **App logo** | Upload RoMonetize logo (optional but recommended) |
| **Application home page** | `https://www.romonetize.com` |
| **Application privacy policy link** | `https://www.romonetize.com/privacy` |
| **Application terms of service link** | `https://www.romonetize.com/terms` |
| **Authorized domains** | `romonetize.com` |

4. Click **Save and Continue**

---

## Step 2: Verify OAuth Client Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click on your OAuth 2.0 Client ID
3. Verify **Authorized redirect URIs** includes:
   ```
   https://ccxyrhvumifactxmjzbe.supabase.co/auth/v1/callback
   ```
   (This is required - Supabase handles the OAuth callback, then redirects to your app)

---

## Step 3: Verify Supabase Dashboard Settings

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select the RoMonetize project

### Project Settings → General
- **Project name**: `RoMonetize`

### Authentication → URL Configuration
- **Site URL**: `https://www.romonetize.com`
- **Redirect URLs** (add all of these):
  ```
  https://www.romonetize.com/auth/callback
  https://www.romonetize.com/dashboard
  https://romonetize.com/auth/callback
  https://romonetize.com/dashboard
  http://localhost:3000/auth/callback
  ```

### Authentication → Providers → Google
- Verify Google OAuth is enabled with correct Client ID and Secret

---

## App Code (Already Correct)

The app code uses dynamic origin detection, which is correct:

```typescript
// components/landing/auth-modal.tsx
redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`
```

This resolves to:
- Production: `https://www.romonetize.com/auth/callback?next=/dashboard`
- Development: `http://localhost:3000/auth/callback?next=/dashboard`

No code changes needed.

---

## Verification

After updating Google Cloud Console:

1. Clear browser cache or use incognito
2. Go to https://www.romonetize.com
3. Click "Sign in with Google"
4. Consent screen should now show:
   - **App name**: RoMonetize
   - **Domain**: romonetize.com (not supabase.co)

---

## Troubleshooting

### Still seeing Supabase URL?
- Changes to OAuth consent screen can take a few minutes to propagate
- Try clearing cookies/cache or use a new incognito window
- Verify you're editing the correct Google Cloud project

### Login fails after changes?
- Ensure the Supabase callback URL is still in Google's authorized redirect URIs
- The callback flow is: Google → Supabase → Your app
- Supabase URL must remain authorized even though it won't be displayed

### Different branding for different users?
- Users who previously consented may see cached consent
- New users or re-consent will see updated branding
