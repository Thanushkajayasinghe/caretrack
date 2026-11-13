# CareTrack — Testing & Quality Assurance Guide

## 1. Test Environment & Devices
* **Development Machine**: Windows 11 PC, PowerShell / CMD.
* **Target Devices**:
  * Physical Device: Xiaomi / Redmi / Poco running HyperOS / MIUI (Android 14).
  * Architecture: `arm64-v8a`.
* **Connectivity**: ADB over USB (`adb devices`) and local Wi-Fi.

---

## 2. Build & Deployment Procedures

### A. Quick Update (Already Compiled APKs)
```powershell
# Install child app without wiping data
adb install -r "d:\Projects\CareTrack\apk\child-app.apk"

# Install parent app without wiping data
adb install -r "d:\Projects\CareTrack\apk\parent-app.apk"
```
*(Always include the `-r` flag to preserve paired authentication tokens and offline SQLite cache).*

### B. Fast Development Debug Build (~30–45s)
```powershell
# Child App:
cd d:\Projects\CareTrack\child-app
npm run bundle:android
cd android
.\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a -x lint
adb install -r "app\build\outputs\apk\debug\app-debug.apk"

# Parent App:
cd d:\Projects\CareTrack\parent-app
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res
cd android
.\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a -x lint
adb install -r "app\build\outputs\apk\debug\app-debug.apk"
```

### C. Full Production Release Build (~8–10m)
```powershell
# Child App:
cd d:\Projects\CareTrack\child-app\android
.\gradlew.bat assembleRelease
copy /Y "app\build\outputs\apk\release\app-release.apk" "d:\Projects\CareTrack\apk\child-app.apk"

# Parent App:
cd d:\Projects\CareTrack\parent-app\android
.\gradlew.bat assembleRelease
copy /Y "app\build\outputs\apk\release\app-release.apk" "d:\Projects\CareTrack\apk\parent-app.apk"
```

---

## 3. Core Test Scenarios & Procedures

| Test ID | Scenario | Procedure | Expected Result |
|---|---|---|---|
| **TC-01** | Device Administrator Activation | Open Child App $\rightarrow$ Tamper Guard $\rightarrow$ Tap "Activate Device Administrator". | Phone displays system Device Admin confirmation dialog with explanation. |
| **TC-02** | Accessibility Guard Activation | Open Child App $\rightarrow$ Tamper Guard $\rightarrow$ Tap "Enable Accessibility Service". | Navigates to Xiaomi Accessibility settings. User toggles CareTrack Child ON. |
| **TC-03** | Display Over Other Apps | Open Child App $\rightarrow$ Tamper Guard $\rightarrow$ Tap "Grant Overlay Permission". | Opens system "Display over other apps" list without closing or crashing the child app. |
| **TC-04** | Master PIN Setup | Enter 4+ digit PIN in Tamper Guard modal $\rightarrow$ Confirm. | PIN saved; Tamper Guard status turns green ("Protected"). |
| **TC-05** | Uninstall Prevention | With Device Admin active, attempt to drag CareTrack Child to "Uninstall". | Android blocks uninstallation and reports that the app is an active device admin. |
| **TC-06** | Settings Force Stop Interception | With Accessibility active, open phone Settings $\rightarrow$ Apps $\rightarrow$ CareTrack Child $\rightarrow$ tap "Force Stop". | Accessibility service immediately intercepts action, returns to home screen or presents PIN challenge. |
| **TC-07** | Live Location Streaming | Open Parent App Live Map while Child App is active in background. | Leaflet map displays child marker at current coordinates with direction arrow and battery indicator. |
| **TC-08** | Stationary State Transition | Leave child phone motionless for 2+ minutes. | Status changes to "Stationary" in both Child App notification and Parent Live Map. Battery syncs without GPS drift. |
| **TC-09** | Offline Buffering & Flush | Turn child phone to Airplane Mode $\rightarrow$ walk 50m $\rightarrow$ Turn Airplane Mode OFF. | Points buffered in SQLite; automatically batch-flushed to backend on reconnect. No gaps in history. |
| **TC-10** | Road Snapping Polyline | View route history in Parent App. | Polyline snaps tightly to street centerlines via Mapbox/OSRM rather than cutting through buildings. |

---

## 4. Previous Test Results (Summary)
* **Builds**: Both `child-app.apk` and `parent-app.apk` compile cleanly with Gradle 8.10.2 (Exit 0).
* **Live Pairing**: QR generation and claiming tested and verified.
* **Server Health**: Verified backend health check and socket reconnection.
* **Xiaomi Compatibility**: Device Admin and Overlay prompts confirmed working with Activity context fixes.

---

## 5. Known Regressions & Watch Items
* **Xiaomi "Restricted Setting" Warning**: On Android 13/14, Xiaomi blocks Accessibility and Notification Listener permissions on sideloaded APKs by default until manually allowed under App Info $\rightarrow$ 3 dots $\rightarrow$ "Allow restricted settings".
* **Manual Bundling in Release**: Never run `npm run bundle:android` before `assembleRelease` without deleting `android/app/src/main/assets/index.android.bundle` afterwards, as it can cause duplicate resource collisions during release builds.
