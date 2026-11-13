# CareTrack — Current Session State

## 1. Current Development Status
* **Status**: Google OAuth 2.0 Sign-In fully implemented, tested, and working seamlessly in Expo Go and on the live Render backend. All changes verified by the user.
* **Parent App**: Running live on connected Xiaomi phone via standard Expo Go (`npx expo start --tunnel`).
* **Backend**: Live on Render (`https://caretrack-backend-kv2n.onrender.com`) on branch `main` (commit `624ab5c`).
* **Database**: PostgreSQL on Render with `google_id`, nullable `password_hash`, and `auth_provider` schema updates active.
* **Child App**: Native Kotlin background tracker service (`apk/child-app.apk`).

---

## 2. What Has Been Completed In This Session

### Google OAuth 2.0 Integration & Direct Relay Architecture
1. **Database Schema Enhancements**:
   * Updated `parents` table in PostgreSQL:
     * `google_id`: VARCHAR(255) UNIQUE (nullable).
     * `password_hash`: Made nullable to allow passwordless OAuth logins.
     * `auth_provider`: VARCHAR(20) DEFAULT `'local'` (`'local' | 'google'`).
   * Backfilled existing parents to `auth_provider = 'local'`.
2. **Backend API Routes (`backend/src/routes/auth.js`)**:
   * **`POST /api/auth/google`**:
     * Verifies Google credentials using Google's `OAuth2Client.verifyIdToken`.
     * Includes automated fallback to Google `tokeninfo` API to handle audience variations between Web and mobile clients.
     * Automatically links existing accounts if a parent previously registered with the same email.
     * Creates new parent records for first-time Google sign-ins.
     * Issues standard JWT `accessToken` & `refreshToken`.
     * Calculates and returns `isProfileComplete` (requires valid non-empty `phone`).
   * **`PUT /api/auth/profile`**:
     * Protected route requiring parent JWT authentication.
     * Updates parent `name`, `phone`, and `avatar_url`.
   * **`GET /api/auth/google/callback` Relay**:
     * Direct OAuth relay served by the backend, completely bypassing `auth.expo.io`.
     * Receives Google redirect containing tokens/auth state.
     * Serves dark-mode themed return page with automated Android Intent redirection.
3. **Parent App Google Sign-In Flow (`parent-app/`)**:
   * **`parent-app/src/services/googleAuth.js`**:
     * Configured `WebBrowser.openAuthSessionAsync` with `browserPackage: 'com.android.chrome'`.
     * Configured `createTask: true`, `useProxyActivity: false`, and `showInRecents: false` to attach `FLAG_ACTIVITY_NO_HISTORY` to Chrome Custom Tabs.
     * Extracted tokens from both hash fragments and query strings.
     * Stored tokens, user metadata, and `authProvider` in `AsyncStorage`.
   * **`parent-app/src/screens/auth/LoginScreen.js`**:
     * Added official multi-color Google "G" SVG button.
     * Added `CompleteProfileModal` prompting newly registered Google users to supply their mandatory phone number.
4. **Resolution of Android Chrome Custom Tab Auto-Dismissal in Expo Go**:
   * **Problem**: In Expo Go on Android, after the user authenticated with Google, the Chrome Custom Tab stayed open in the foreground. The user had to manually tap ✕ to close the browser, thinking the login failed, even though the app was already authenticated underneath.
   * **Root Cause 1**: `createTask: false` forced Chrome Custom Tabs into the same Android task stack as Expo Go. Because it ran in the same task without `FLAG_ACTIVITY_NO_HISTORY`, Android kept Custom Tabs on top of Expo Go even after the intent was dispatched.
   * **Root Cause 2**: Standard `exp://` links did not specify task launch flags or target package names, so Android OS did not force a foreground task switch.
   * **Fix**:
     * In `googleAuth.js`, set `createTask: true`, `useProxyActivity: false`, `showInRecents: false`. This triggers line 90 of `CustomTabsActivitiesHelper.kt`, applying `FLAG_ACTIVITY_NO_HISTORY`.
     * In `backend/src/routes/auth.js`, formatted the redirect into an explicit Android Intent URI:
       `intent://<tunnel-host>/--/google-auth-callback?...#Intent;scheme=exp;package=host.exp.exponent;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;launchFlags=0x14000000;end`.
     * When Chrome handles this intent, Android's ActivityManager brings Expo Go to the foreground and immediately destroys the Custom Tab.

---

## 3. What Was Investigated
* **Custom Development Client vs. Expo Go**:
  * Evaluated building a custom development client (`@react-native-google-signin/google-signin`).
  * User confirmed local Gradle builds take >20 minutes on their computer.
  * Formally committed to keeping Parent App development 100% inside standard Expo Go with fast refresh.
* **Chrome Android Navigation Blocking (`Navigation is blocked due to lack of user gesture`)**:
  * Investigated why synchronous `window.location.replace('exp://...')` looped back to Google account selection.
  * Finding: Chrome 80+ explicitly blocks unprompted redirects to external custom URI schemes without a user gesture. Resolved by pairing an intent launch button with `FLAG_ACTIVITY_NO_HISTORY` and foreground intent flags.

---

## 4. Current Implementation State
* **Parent App**:
  * Runs on device `1d8a5b05` via `npx expo start --tunnel`.
  * Google Sign-In functions seamlessly: user taps button $\rightarrow$ selects account in Chrome $\rightarrow$ browser automatically dismisses $\rightarrow$ app appears logged in.
  * Standard email/password login remains fully functional.
* **Backend**:
  * Live on Render at `https://caretrack-backend-kv2n.onrender.com`.
  * Google OAuth callback and token exchange endpoints tested and verified live.
* **Child App**:
  * Unchanged and stable.

---

## 5. Current Bugs & Problems
* **None**: All issues identified during this session (database schema, token exchange, browser dismissal) have been resolved and verified by the user.

---

## 6. Tests Performed and Their Results
1. **Google ID Token Verification**: Validated with Google's public tokeninfo endpoint (Pass).
2. **Database Migration**: Tested column insertion and constraints on Render PostgreSQL (Pass).
3. **Backend Deployment**: Verified `GET /api/auth/google/callback` returns the new Intent HTML payload live from Render (Pass).
4. **Metro Tunnel Bundle**: Verified bundle generation on port 8081 without bundling or syntax errors (Pass).
5. **Physical Device Verification (Xiaomi HyperOS `1d8a5b05`)**: User tested Google Sign-In end-to-end; confirmed seamless login and auto-return to CareTrack (Pass).

---

## 7. Exact Next Steps & Unfinished Work
1. **Next Steps**:
   * Solicit user's next priority for CareTrack (e.g. testing child tracking, geofence alerts, trip history UI, or production deployment preparation).
2. **Unfinished Work**: None. Google Sign-In is completely finished and clean.
