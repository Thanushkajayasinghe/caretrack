# CareTrack — System Architecture

## 1. High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                              CareTrack                                 │
└────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────┐               ┌──────────────────────────┐
  │   Child Device (Android)│               │   Parent Device (Android)│
  │                         │               │                          │
  │  ┌───────────────────┐  │               │  ┌────────────────────┐  │
  │  │  React Native UI  │  │               │  │  React Native UI   │  │
  │  └─────────┬─────────┘  │               │  └─────────┬──────────┘  │
  │            │            │               │            │             │
  │  ┌─────────▼─────────┐  │               │  ┌─────────▼──────────┐  │
  │  │ Native Kotlin Svc │  │               │  │ Leaflet Map (OSM)  │  │
  │  │ - FusedLocation   │  │               │  │ - Road Snapping    │  │
  │  │ - Kalman Filter   │  │               │  │   (Mapbox/OSRM)    │  │
  │  │ - Motion/Activity │  │               │  │ - History Replay   │  │
  │  │ - SQLite Buffer   │  │               │  │ - Child Selector   │  │
  │  │ - Tamper Guard    │  │               │  └─────────▲──────────┘  │
  │  └─────────┬─────────┘  │               │            │             │
  └────────────┼────────────┘               └────────────┼─────────────┘
               │                                         │
               │ HTTP Batch /                            │ Socket.IO /
               │ Device Token Auth                       │ Parent JWT Auth
               ▼                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Node.js / Express Backend                       │
│                                                                        │
│  ┌───────────────────────┐                  ┌───────────────────────┐  │
│  │     REST Endpoints    │                  │   Socket.IO Gateway   │  │
│  │ - /api/auth           │                  │ - Room: parent:{id}   │  │
│  │ - /api/pair           │                  │ - Redis Adapter       │  │
│  │ - /api/children       │                  │ - Realtime Broadcaster│  │
│  │ - /api/location/batch │                  │                       │  │
│  └───────────┬───────────┘                  └───────────▲───────────┘  │
│              │                                          │              │
│              └─────────────────────┬────────────────────┘              │
│                                    │                                   │
│                        ┌───────────▼───────────┐                       │
│                        │     Data & Cache      │                       │
│                        │  - PostgreSQL+PostGIS │                       │
│                        │  - Redis 7+           │                       │
│                        └───────────────────────┘                       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Main Modules & Components

### A. Child App Modules
* **`CareTrackLocationService.kt`**:
  * Foreground service with ongoing persistent notification.
  * Interfaces with Google Play Services `FusedLocationProviderClient`.
  * Manages GPS intervals: high frequency (3–5s) during motion; low frequency (60s) when stationary.
  * Performs local Kalman filtering (`KalmanLocationFilter.kt`) to eliminate GPS jitter.
* **`OfflineLocationDb.kt`**:
  * Local SQLite storage capturing coordinates, speed, battery, heading, and timestamp.
  * Guarantees zero location loss during network dropouts or signal loss.
* **`TamperGuardManager.kt` & Guards**:
  * `CareTrackAdminReceiver.kt`: Device Administrator component preventing uninstallation.
  * `CareTrackAccessibilityGuardService.kt`: Intercepts system settings navigation to "Force Stop" or "Clear Data" for the CareTrack package.
  * `TamperUnlockActivity.kt`: Fullscreen PIN challenge overlay displayed when unauthorized access is detected.
* **`ActivityTransitionReceiver.kt`**:
  * Registers Android Activity Recognition (STILL, WALKING, RUNNING, IN_VEHICLE) for immediate stationary/motion transitions.

### B. Backend Modules
* **REST Routes (`backend/src/routes/`)**:
  * `auth.js`: Parent registration, login, refresh token rotation with bcrypt password hashing.
  * `pair.js`: QR code session generation (`/api/pair/generate`), OTP hashing, and child device claiming (`/api/pair/claim`).
  * `child.js`: Child profiles, avatar color/name updates, device status queries.
  * `location.js`: Location batch upload (`/api/location/batch`), latest live location, trip segmentation, historical breadcrumb queries.
* **Socket.IO Gateway (`backend/src/sockets/index.js`)**:
  * Parent connects and joins a private room: `parent:<parent_id>`.
  * When child location batches arrive, the backend broadcasts `location:update` immediately to the parent room.
* **Caching & Storage Services (`backend/src/services/`)**:
  * `locationCache.js`: In-memory Redis cache for the latest coordinates, battery state, and motion status of each child.
  * `tokenService.js`: HMAC-SHA256 generation and verification for hardware-bound child device tokens.

### C. Parent App Modules
* **Navigation (`parent-app/src/navigation/`)**:
  * Bottom Tab Navigator: `Dashboard`, `Map`, `History`, `Pair`, `Settings`.
* **Map Screen (`parent-app/src/screens/Map/MapScreen.js`)**:
  * Embedded Leaflet OpenStreetMap in `react-native-webview`.
  * Custom markers for child position, heading arrow, stationary circle, and parent location.
  * Live status bar showing battery, speed, and motion state.
* **Road Snapping Engine (`parent-app/src/services/roadSnapping.js`)**:
  * Snaps raw GPS points to real road centerlines before rendering on the Leaflet polyline.
  * 4-Tier fallback: Mapbox $\rightarrow$ OSRM Match $\rightarrow$ OSRM Route $\rightarrow$ Raw GPS.

---

## 3. Data Flow

### Location Tracking & Real-Time Sync Flow
```
1. Child GPS Event (FusedLocationProvider)
   │
2. Kalman Filter & Stationary State Machine
   │
3. Local SQLite Insert (Offline buffer)
   │
4. Batch Flush (HTTP POST /api/location/batch)
   ├── Header: Authorization: Bearer <deviceToken>
   └── Header: X-Device-Fingerprint: <fingerprint>
   │
5. Backend Auth & Validation
   ├── Verify HMAC-SHA256 hash against device record
   └── Zod batch validation
   │
6. Database & Cache Write
   ├── Insert into PostgreSQL locations table (PostGIS Point)
   └── Update Redis key: child:location:<child_id>
   │
7. Real-Time Socket Broadcast
   └── Socket.IO emit to room parent:<parent_id> ('location:update')
   │
8. Parent App Receives Event
   ├── Update Bottom Sheet (Battery, Speed, State)
   ├── Snap latest point to road (roadSnapping.js)
   └── Inject JavaScript to Leaflet WebView to animate marker
```

### Pairing Flow
```
1. Parent App: POST /api/pair/generate
   └── Backend creates pairing_session with random 6-digit OTP & UUID
   └── Returns QR payload + OTP to Parent
   │
2. Child App: Scans QR code or enters OTP
   └── Reads session UUID and code
   │
3. Child App: POST /api/pair/claim
   ├── Body: { sessionId, code, deviceFingerprint, deviceName }
   └── Backend verifies code_hash and expiry
   └── Backend creates child_devices record with HMAC device_token_hash
   └── Returns deviceToken to Child
   │
4. Child App saves deviceToken and fingerprint in AsyncStorage
   │
5. Backend emits 'child:paired' to parent room
   └── Parent App automatically refreshes child list
```

---

## 4. Database Structure (PostgreSQL + PostGIS)

### Tables & Relationships
1. **`parents`**:
   * `id` (UUID, PK)
   * `email` (VARCHAR, UNIQUE)
   * `password_hash` (TEXT)
   * `name` (VARCHAR), `phone` (VARCHAR), `avatar_url` (TEXT)
   * `created_at`, `updated_at` (TIMESTAMPTZ)
2. **`refresh_tokens`**:
   * `id` (UUID, PK)
   * `parent_id` (UUID, FK $\rightarrow$ parents.id ON DELETE CASCADE)
   * `token_hash` (TEXT, UNIQUE), `expires_at` (TIMESTAMPTZ), `revoked` (BOOLEAN)
3. **`children`**:
   * `id` (UUID, PK)
   * `parent_id` (UUID, FK $\rightarrow$ parents.id ON DELETE CASCADE)
   * `name` (VARCHAR), `avatar_url` (TEXT), `avatar_color` (VARCHAR)
4. **`child_devices`**:
   * `id` (UUID, PK)
   * `child_id` (UUID, FK $\rightarrow$ children.id ON DELETE CASCADE)
   * `device_token_hash` (TEXT, UNIQUE)
   * `device_fingerprint_hash` (TEXT)
   * `device_name` (VARCHAR), `android_version` (VARCHAR)
   * `battery_level` (SMALLINT), `is_charging` (BOOLEAN)
   * `last_seen` (TIMESTAMPTZ), `is_active` (BOOLEAN)
5. **`pairing_sessions`**:
   * `id` (UUID, PK)
   * `parent_id` (UUID, FK $\rightarrow$ parents.id ON DELETE CASCADE)
   * `child_id` (UUID, FK $\rightarrow$ children.id ON DELETE SET NULL)
   * `code_hash` (TEXT), `expires_at` (TIMESTAMPTZ), `claimed` (BOOLEAN)
6. **`locations`**:
   * `id` (BIGSERIAL, PK)
   * `child_id` (UUID, FK $\rightarrow$ children.id ON DELETE CASCADE)
   * `location` (GEOMETRY(Point, 4326), Spatial Index GIST)
   * `accuracy` (FLOAT), `speed` (FLOAT), `heading` (FLOAT), `altitude` (FLOAT)
   * `battery_level` (SMALLINT), `is_charging` (BOOLEAN)
   * `recorded_at` (TIMESTAMPTZ), `synced_at` (TIMESTAMPTZ)
   * `UNIQUE(child_id, recorded_at)`
