# CareTrack — Architectural & Technical Decisions Record (ADR)

This document tracks important technical decisions, rationale, and rejected alternatives. When a decision is replaced, it must be marked as **SUPERSEDED** rather than deleted.

---

## ADR-001: Custom Native Kotlin Service vs. Third-Party Tracking SDKs
* **Status**: ACCEPTED
* **Context**: The child app needs guaranteed background location tracking with stationary rest detection, battery optimization bypass, and auto-restart on Android 10–14.
* **Decision**: Implement a custom native Android Kotlin foreground service (`CareTrackLocationService.kt`) directly interfacing with Google Play Services `FusedLocationProviderClient`, Android `ActivityRecognitionClient`, and custom SQLite queue.
* **Why**:
  * Gives 100% control over notification channels, foreground service types (`FOREGROUND_SERVICE_LOCATION`), and wake lock management.
  * Eliminates expensive recurring license fees of commercial tracking SDKs.
  * Allows deep integration with custom anti-tampering guards and local Kalman filtering.
* **Alternatives Rejected**:
  * `react-native-background-geolocation` (TransistorSoft): High commercial license fee; black-box native implementation.
  * Standard React Native `navigator.geolocation`: Terminated by Android OS when app is backgrounded or killed.

---

## ADR-002: Leaflet + OpenStreetMap in WebView vs. Google Maps SDK
* **Status**: ACCEPTED
* **Context**: The parent app requires a responsive map for live tracking, direction headings, and breadcrumb history replay.
* **Decision**: Embed Leaflet.js with OpenStreetMap (OSM) tile layers inside a React Native `WebView`.
* **Why**:
  * **Zero API Cost & Zero Quotas**: Completely free with no credit card or Google Cloud billing required.
  * High flexibility: Easy to render animated pulse circles, direction arrows, and custom SVG icons without native bridge performance bottlenecks.
  * Cross-platform consistency.
* **Alternatives Rejected**:
  * `react-native-maps` with Google Maps SDK: Requires active Google Cloud billing, API key restriction setup, and incurs charges once free thresholds are exceeded.
  * Mapbox Native SDK: Requires Mapbox mobile SDK token and downloads heavy native binary dependencies.

---

## ADR-003: 4-Tier Road Snapping Architecture
* **Status**: ACCEPTED
* **Context**: Raw GPS points produce zigzagging polylines and GPS drift through buildings rather than aligning with actual streets.
* **Decision**: Implement a 4-tier road snapping fallback pipeline in [`roadSnapping.js`](file:///d:/Projects/CareTrack/parent-app/src/services/roadSnapping.js):
  1. **Tier 1**: Mapbox Map Matching API (high precision, 100,000 free monthly requests).
  2. **Tier 2**: Public OSRM Match API (`/match/v1/driving`).
  3. **Tier 3**: Public OSRM Route API (`/route/v1/driving`).
  4. **Tier 4**: Raw GPS coordinates fallback (for off-road paths, open fields, or offline scenarios).
* **Why**:
  * Ensures polished, road-aligned breadcrumbs without single-point-of-failure risk if Mapbox or OSRM is unreachable or rate-limited.
  * Client-side caching of snapped paths prevents redundant network requests for identical polyline segments.
* **Alternatives Rejected**:
  * Server-side road snapping on every single point: Adds heavy latency and external API dependency to the core location ingestion pipeline.
  * Pure raw GPS lines: Unprofessional appearance with GPS noise/drift visible to parents.

---

## ADR-004: Hardware-Bound Device Token Authentication for Child Devices
* **Status**: ACCEPTED
* **Context**: Child devices need secure authentication to upload location batches without requiring user interaction (passwords) once paired.
* **Decision**: Authenticate child devices using an HMAC-SHA256 hash of the issued `deviceToken` cryptographically bound to the device's hardware fingerprint (`Build.FINGERPRINT`).
* **Why**:
  * If a token is somehow extracted from the device storage, it cannot be used on another physical device.
  * Lightweight verification for high-frequency location batch uploads.
* **Alternatives Rejected**:
  * Standard username/password: Not suitable for headless background service operation.
  * Unbound API tokens: Vulnerable to credential theft and spoofing.

---

## ADR-005: Dual-Layer Anti-Tamper Guard
* **Status**: ACCEPTED
* **Context**: Children may attempt to uninstall CareTrack, force-stop it in Android Settings, or clear app storage.
* **Decision**: Implement a 3-part tamper protection system:
  1. **Android Device Administrator** (`CareTrackAdminReceiver.kt`): Blocks direct uninstallation from the home screen or app drawer.
  2. **Android Accessibility Service** (`CareTrackAccessibilityGuardService.kt`): Monitors system window state and intercepts navigation to "Force Stop" or "Clear Data" in Android Settings for `com.helloworld`.
  3. **Master PIN Overlay** (`TamperUnlockActivity.kt`): Displays a fullscreen PIN challenge if unauthorized tampering is detected; allows parents to unlock maintenance mode.
* **Why**:
  * Standard Android permissions do not prevent a user from going into Settings and hitting "Force Stop". Accessibility monitoring provides real-time detection and dismissal of the Settings screen.
* **Alternatives Rejected**:
  * Root-only solutions: Impractical for standard consumer devices.
  * Pure Device Admin: Only blocks uninstall, does not block "Force Stop" or "Disable Notifications" in Settings.

---

## ADR-006: Intent Launch Context on Xiaomi / HyperOS
* **Status**: ACCEPTED
* **Context**: On Xiaomi / HyperOS devices (Android 11–14), calling system intents (`ACTION_ADD_DEVICE_ADMIN`, `ACTION_MANAGE_OVERLAY_PERMISSION`) with an Application Context failed silently or crashed the task.
* **Decision**: Always resolve the foreground `currentActivity` first (`currentActivity ?: reactApplicationContext`), and provide explicit fallback intents to generic settings pages (`DEVICE_ADMIN_SETTINGS`, `ACTION_SECURITY_SETTINGS`, `APPLICATION_DETAILS_SETTINGS`).
* **Why**:
  * Xiaomi's MIUI/HyperOS security framework strictly enforces Activity contexts for privileged system dialogs.
* **Alternatives Rejected**:
  * Using only `reactApplicationContext.startActivity(intent)` with `FLAG_ACTIVITY_NEW_TASK`.

---

## ADR-007: Removal of Movement Sensitivity & App Preferences from Parent Settings
* **Status**: ACCEPTED
* **Context**: Parent Settings screen contained complex sensitivity threshold sliders and informational status rows that cluttered the UI and duplicated functionality.
* **Decision**: Removed "Movement detection sensitivity" and "App preferences & status" cards from `SettingsScreen.js` by user request, keeping Settings focused on Server Connection and Account management.
* **Why**:
  * Simplifies parent interface; movement thresholds are handled adaptively by Android Activity Recognition and Kalman filter without requiring manual fine-tuning.

---

## ADR-008: Flow-Based Bottom Container for Map Screen Overlays vs. Absolute Positioning
* **Status**: ACCEPTED
* **Context**: In `MapScreen.js`, raising the details card to clear the floating bottom navigation bar caused absolute positioned FABs (`fabStack` at hardcoded `bottom: 225`) to overlap directly onto the details card on varied screen dimensions and dynamic card heights.
* **Decision**: Group the FAB stack and the details card inside a dedicated `bottomSection` container that manages the bottom clearance (`paddingBottom: Platform.OS === 'ios' ? 104 : 96`). Position `fabStack` with `alignSelf: 'flex-end'` and a margin directly above `bottomCard` in natural flex-column flow rather than absolute coordinate offsets.
* **Why**:
  * Guarantees zero overlap regardless of font scaling, screen dimensions, or dynamic banner content (e.g. stationary/moving banners, offline notices).
  * Automatically positions the FAB stack correctly whether the details card is present or hidden.
* **Alternatives Rejected**:
  * Hardcoding higher `bottom` offset values on `fabStack`: Prone to breakage across different screen aspect ratios and text wrapping.

---

## ADR-009: Borderless Asset Generation for Preset Child Avatars
* **Status**: ACCEPTED
* **Context**: Child avatar PNG assets previously had circular border graphics baked into the image files. Displaying them in container views that applied their own circular borders created unsightly double-border rings on the Dashboard and Pair screens.
* **Decision**: Keep all image assets borderless (character portrait on clean transparent/dark background) and delegate all borders, radiuses, and decorative rings exclusively to React Native container styles (`borderWidth`, `borderColor`, `borderRadius`).
* **Why**:
  * Eliminates double-border artifacts.
  * Allows UI components (e.g., squircles in `PairScreen`, circular dashed rings in `ChildStatusCard`) to define their own framing consistently.

---

## ADR-010: Workspace Ignore Rules and Native Build Intermediates Sanitization
* **Status**: ACCEPTED
* **Context**: The workspace accumulated over 30 GB and 110,000 files across `child-app` and `parent-app`. React Native C++ libraries (`react-native-reanimated`, `react-native-screens`, `react-native-vision-camera`, `react-native-gesture-handler`) generated ~20 GB of intermediate NDK/CMake compilation objects directly inside `node_modules`. Because the workspace lacked `.gitignore` and `.geminiignore`, Antigravity's IDE language server (`language_server_windows_x64.exe`) attempted to watch, index, and upload these tens of thousands of modified binary/build files, consuming 43+ GB of network upload bandwidth to Google Cloud endpoints.
---

## ADR-011: Google OAuth 2.0 via Direct Backend Relay & Auto-Dismissing Intent in Expo Go
* **Status**: ACCEPTED
* **Context**: The Parent App required Google Sign-In authentication. Standalone Google Sign-In SDKs (`@react-native-google-signin/google-signin`) require native Android modules that do not run inside standard Expo Go, necessitating custom development builds (`npx expo run:android`), which take >20 minutes on the developer's computer. Standard Expo `auth.expo.io` proxies trigger unverified domain warnings or auth proxy issues. Furthermore, in Expo Go on Android, opening Chrome Custom Tabs previously failed to dismiss when redirected back to the app, leaving users staring at Chrome unless manually dismissed.
* **Decision**:
  1. **Direct Backend Relay**: Configure Google OAuth Client ID with `redirect_uri` pointing to the live Render backend (`https://caretrack-backend-kv2n.onrender.com/api/auth/google/callback`). Bypasses `auth.expo.io` entirely.
  2. **Custom Tab Task Separation & Auto-Dismissal**: In `parent-app/src/services/googleAuth.js`, invoke `WebBrowser.openAuthSessionAsync` with `createTask: true`, `useProxyActivity: false`, and `showInRecents: false`. In Android's Custom Tabs implementation (`CustomTabsActivitiesHelper.kt`), this automatically applies `FLAG_ACTIVITY_NEW_TASK` and `FLAG_ACTIVITY_NO_HISTORY` to the Custom Tab.
  3. **Explicit Android Intent Navigation**: On the backend callback page (`GET /api/auth/google/callback`), forward tokens via an explicit Android Intent URI targeting Expo Go:
     `intent://<tunnel-host>/--/google-auth-callback?...#Intent;scheme=exp;package=host.exp.exponent;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;launchFlags=0x14000000;end`.
     When handled by Chrome on Android, this commands Android's ActivityManager to bring Expo Go to the foreground and, combined with `FLAG_ACTIVITY_NO_HISTORY`, immediately destroys the Custom Tab.
  4. **Account Linking & Mandatory Phone Number**: The backend automatically links existing email accounts if Google email matches an existing parent. A `CompleteProfileModal` prompts newly registered Google users for their mandatory mobile phone number before continuing to the dashboard.
* **Why**:
  * 100% compatible with standard Expo Go (`npx expo start --tunnel`), preserving instant fast refresh and avoiding 20+ minute local Gradle compilation times.
  * Ensures a seamless mobile UX where the browser opens, authenticates, and disappears automatically without requiring manual dismissal.
* **Alternatives Rejected**:
  * Local Gradle Development Client (`npx expo run:android`): Compilation takes >20 minutes per build on developer's hardware.
  * Standard `exp://` URL without Intent flags: Left Chrome Custom Tab floating in the foreground on top of the app stack.
  * `auth.expo.io` proxy: Subject to unverified Google app warnings and third-party proxy dependencies.


