# CareTrack — Project Context

## 1. Overall Project Purpose
**CareTrack** is an end-to-end, real-time parental monitoring and child safety platform. It enables parents to monitor child location, movement state (stationary resting vs. walking/moving), route history with road snapping, device battery status, and protection against app tampering/uninstallation.

The platform consists of three main components:
1. **`backend/`**: Node.js/Express REST API and Socket.IO server backed by PostgreSQL (PostGIS) and Redis.
2. **`child-app/`**: React Native (Android) background tracker featuring a custom native Kotlin foreground service, Kalman filtering, motion detection, offline SQLite queue, and Tamper Guard.
3. **`parent-app/`**: React Native (Android) monitoring application featuring live Leaflet / OpenStreetMap tracking, 4-tier road snapping, historical trip reconstruction, and child device management.

---

## 2. Technology Stack

### Backend
* **Runtime**: Node.js 20+ (ES Modules `"type": "module"`)
* **Framework**: Express 5
* **Database**: PostgreSQL 16+ with `postgis` (spatial geography point indexing) and `pgcrypto`
* **Cache & Realtime**: Redis 7+ (`ioredis`), `@socket.io/redis-adapter`
* **WebSocket**: Socket.IO 4.8
* **Authentication**: JWT (`jsonwebtoken`) for parents; Google OAuth 2.0 (via direct backend relay and token verification); HMAC-SHA256 hardware-bound tokens for child devices; `bcryptjs` for parent password hashing
* **Validation & Security**: Zod, Helmet, Express Rate Limit, Morgan

### Child App (Android)
* **Framework**: React Native 0.76.9
* **Native Language**: Kotlin (`child-app/android/app/src/main/java/com/helloworld/`)
* **Location Engine**: Custom native foreground service (`CareTrackLocationService.kt`) with Google Play Services `FusedLocationProviderClient`
* **Filtering & Motion**: Custom 1D Kalman filter (`KalmanLocationFilter.kt`), Android `ActivityRecognitionClient` (`ActivityTransitionReceiver.kt`)
* **Offline Storage**: Custom Android SQLite database (`OfflineLocationDb.kt`) with auto-flush via NetInfo/Service
* **Anti-Tampering**: Android Device Administrator (`CareTrackAdminReceiver.kt`), Accessibility Service (`CareTrackAccessibilityGuardService.kt`), System Alert Overlay (`TamperUnlockActivity.kt`)
* **Camera**: `react-native-vision-camera` for QR code pairing

### Parent App (Android)
* **Framework**: React Native 0.76.9
* **Navigation**: `@react-navigation/native` & `@react-navigation/native-stack` 7.x
* **Map Engine**: `react-native-webview` rendering Leaflet + OpenStreetMap tiles (eliminating Google Maps API key requirements and billing limits)
* **Road Snapping**: Mapbox Map Matching API (`pk.eyJ1IjoiY2FydGpheWFzaW5naGUiLCJhIjoiY211NzZ1N2Y3MGNyMjJ4cTBjZXRwczdlNSJ9.r1Z2AAdMmyncIz4XaKGLGQ`) with fallback to OSRM Match, OSRM Route, and raw GPS
* **Realtime Client**: `socket.io-client` 4.8
* **UI/Styling**: Vanilla React Native `StyleSheet`, `react-native-linear-gradient`, `react-native-vector-icons` (Ionicons)

---

## 3. Architecture & Core Concepts
* **Hardware-Bound Authentication**: Child devices authenticate to the backend via an HMAC-SHA256 signature combining the issued `deviceToken` and the hardware fingerprint (`Build.FINGERPRINT`). Tokens cannot be extracted and replayed on other devices.
* **Persistent Foreground Tracking**: The child app runs a sticky foreground service with a persistent notification (`FOREGROUND_SERVICE_LOCATION`), `WAKE_LOCK`, and auto-restart via `BootReceiver` and `WatchdogReceiver`.
* **State Machine (Stationary vs Moving)**:
  * When stationary: Low-power GPS sampling (every 60s or stationary heartbeat).
  * When moving / activity detected: High-frequency GPS sampling (every 3–5s, distance filter ~5–10m).
* **Zero-Billing Mapping**: Map visualization uses OpenStreetMap tiles loaded inside a WebView Leaflet container. No Google Maps billing or API keys are required for map displays.
* **4-Tier Road Snapping**:
  1. Mapbox Map Matching API
  2. OSRM Match API (`/match/v1/driving`)
  3. OSRM Route API (`/route/v1/driving`)
  4. Raw GPS Fallback

---

## 4. Important Design Decisions & Constraints
* **No Third-Party Paid Tracking SDKs**: Built with a custom native Kotlin service rather than paid SDKs (e.g., TransistorSoft Background Geolocation).
* **Preserve Paired Data (`adb install -r`)**: When deploying updates to phones, always use `adb install -r` so application storage (pairing keys, SQLite offline data) is never wiped.
* **Xiaomi / HyperOS / MIUI Specifics**:
  * System intent launches (Device Admin, Overlay, Accessibility) must use `currentActivity ?: reactApplicationContext` or Activity context, otherwise Xiaomi silently ignores or closes the intent.
  * Accessibility Service on sideloaded APKs triggers Xiaomi's "Restricted setting" dialog, requiring user bypass via `Settings -> Apps -> Manage apps -> CareTrack Child -> 3 dots -> Allow restricted settings`.

---

## 5. Things That Must NOT Be Changed Without Asking
1. **Map Engine**: Do NOT replace Leaflet/OSM with Google Maps SDK.
2. **Device Auth**: Do NOT remove hardware-fingerprint binding for child device tokens.
3. **Database Schema**: Do NOT alter PostGIS `locations` geometry table or remove spatial indexes without a migration script.
4. **Settings Screen Panels**: Do NOT restore "Movement detection sensitivity" or "App preferences & status" cards on the Parent Settings screen (explicitly removed by user request).
5. **API & Secret Keys**: Do NOT remove or overwrite the Mapbox access token in `roadSnapping.js`.
6. **Parent App Development Environment**: Do NOT force or require local Gradle builds (`npx expo run:android`) or custom development client compilations for Parent App changes. The user's machine requires >20 minutes per Gradle build; parent app live development must remain compatible with standard Expo Go (`npx expo start --tunnel`).

---

## 6. Current Major Features
* **Pairing Flow**: Parent generates QR code + 6-digit OTP $\rightarrow$ Child scans or enters OTP $\rightarrow$ Backend hardware-binds child device.
* **Live Location Monitoring**: Real-time position tracking, live direction heading, battery percentage, charging state, stationary status indicator.
* **History & Trips**: Historical route replay, stop points clustering, distance/duration metrics, road-snapped polylines.
* **Tamper Guard**: Master PIN protection, Device Administrator to block uninstall, Accessibility Guard to intercept "Force Stop" and "Clear Storage" in phone settings, Overlay lock screen.
* **Offline Buffering**: Transparent local SQLite buffering when disconnected; batch sync when network restores.
