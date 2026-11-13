# CareTrack — Parental Monitoring Platform

A full-stack parental monitoring app with React Native (Android), Node.js backend, PostgreSQL + PostGIS, Redis, and Socket.IO.

## Project Structure

```
CareTrack/
├── backend/          # Node.js + Express API server
├── parent-app/       # React Native parent app (Android)
└── child-app/        # React Native child app (Android)
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ (24 recommended) | |
| PostgreSQL | 16+ | With PostGIS extension |
| Redis | 7+ | |
| Android Studio | Latest | For building Android apps |
| Java JDK | 17 or 21 | Required for Android builds |

---

## Backend Setup

### 1. Install PostgreSQL and enable PostGIS
```sql
CREATE DATABASE caretrack;
\c caretrack
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 2. Configure environment
```bash
cd backend
cp .env.example .env
# Edit .env with your PostgreSQL and Redis credentials
# IMPORTANT: Change all secret values before production use!
```

### 3. Install dependencies and run migrations
```bash
cd backend
npm install
node src/db/migrate.js     # Creates all tables
```

### 4. Start the server
```bash
npm run dev                # Development (with --watch)
npm start                  # Production
```

Backend runs on `http://localhost:3000`.

---

## Parent App Setup

### 1. Install dependencies
```bash
cd parent-app
npm install
```

### 2. Install additional native dependencies
```bash
# Vector icons font linking
npx react-native-asset

# react-native-maps — needs Google Maps SDK key in AndroidManifest.xml for some features
# (OSM tiles work without a key)
```

### 3. Configure API URL
Edit `parent-app/src/services/api.js`:
- Dev (Android emulator): `http://10.0.2.2:3000/api` ← default
- Dev (physical device): Use your PC's IP, e.g. `http://192.168.1.x:3000/api`
- Production: Your server URL

### 4. Run on Android
```bash
# Start Metro bundler
npm start

# In another terminal
npm run android
```

---

## Child App Setup

### 1. Install dependencies
```bash
cd child-app
npm install
```

### 2. Background Geolocation Setup
`react-native-background-geolocation` requires additional setup:
- Follow the [Android Setup Guide](https://transistorsoft.github.io/react-native-background-geolocation/docs/installation/android)
- Add the license key to `android/app/src/main/AndroidManifest.xml`

### 3. Android Permissions
Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.VIBRATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

### 4. Run on Android
```bash
npm start
npm run android
```

---

## Pairing Flow

1. **Parent App**: Go to Pair tab → Enter child's name → Tap "Generate QR Code"
2. **Child App**: Tap "Pair with Parent" → Scan the QR code (or enter 6-digit code)
3. Parent app auto-refreshes and shows the child in the dashboard

---

## API Overview

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/auth/register` | POST | None | Parent registration |
| `/api/auth/login` | POST | None | Parent login |
| `/api/auth/refresh` | POST | Refresh token | Rotate access token |
| `/api/children` | GET | Parent JWT | List children |
| `/api/children` | POST | Parent JWT | Create child profile |
| `/api/pair/generate` | POST | Parent JWT | Generate QR + OTP |
| `/api/pair/claim` | POST | None | Child claims session |
| `/api/location/batch` | POST | Device Token | Child uploads locations |
| `/api/location/live/:id` | GET | Parent JWT | Latest child location |
| `/api/location/history` | GET | Parent JWT | Historical locations |
| `/api/location/trips` | GET | Parent JWT | Segmented trips |

---

## Security Notes

- **Never** commit `.env` to version control
- Change all JWT and HMAC secrets before production
- Device tokens are HMAC-SHA256 bound to hardware fingerprint
- All communication should be over HTTPS in production
- Implement certificate pinning on apps before production deployment

---

## Roadmap

- **Stage 2**: Geofencing alerts (safe zones)
- **Stage 3**: Live screen sharing (MediaProjection API)
- **Stage 4**: Camera streaming (WebRTC)
- **Stage 5**: App usage monitoring (Android Accessibility Service)
- **Stage 6**: Audio monitoring
- **Stage 7**: Content filtering (SafeSearch)
