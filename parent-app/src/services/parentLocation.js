import * as Location from 'expo-location';

let activeLocationSubscription = null;

export async function requestLocationPermission() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.warn('Location permission request failed:', err);
    return false;
  }
}

export async function checkLocationPermission() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    return false;
  }
}

export async function startWatchingParentLocation(onLocation, onError) {
  const hasPerm = await checkLocationPermission();
  if (!hasPerm) {
    const granted = await requestLocationPermission();
    if (!granted) {
      onError?.(new Error('Permission denied'));
      return () => {};
    }
  }

  try {
    if (activeLocationSubscription) {
      activeLocationSubscription.remove();
      activeLocationSubscription = null;
    }

    // Immediately fetch last known position so map renders parent instantly
    try {
      const lastKnown = await Location.getLastKnownPositionAsync({});
      if (lastKnown?.coords) {
        onLocation({
          lat: lastKnown.coords.latitude,
          lng: lastKnown.coords.longitude,
          accuracy: lastKnown.coords.accuracy,
          heading: lastKnown.coords.heading,
          speed: lastKnown.coords.speed,
          timestamp: lastKnown.timestamp,
        });
      }
    } catch (e) {}

    activeLocationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 2500,
        distanceInterval: 2,
      },
      (loc) => {
        if (loc?.coords) {
          onLocation({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
            heading: loc.coords.heading,
            speed: loc.coords.speed,
            timestamp: loc.timestamp,
          });
        }
      }
    );

    return () => {
      stopWatchingParentLocation();
    };
  } catch (err) {
    console.warn('Failed to start watching parent location:', err);
    onError?.(err);
    return () => {};
  }
}

export async function stopWatchingParentLocation() {
  if (activeLocationSubscription) {
    activeLocationSubscription.remove();
    activeLocationSubscription = null;
  }
}

export async function getCurrentParentLocation() {
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    if (!loc?.coords) return null;
    return {
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
      heading: loc.coords.heading,
      speed: loc.coords.speed,
      timestamp: loc.timestamp,
    };
  } catch (e) {
    return null;
  }
}

