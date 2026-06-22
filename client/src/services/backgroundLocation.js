import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  getApiBaseUrl,
  getNativeSessionToken,
  getStoredBranchId,
  setBackgroundLocationEnabled,
} from '../utils/nativeApp';

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

let watcherId = null;

async function ensureNotificationPermission() {
  try {
    const perms = await LocalNotifications.checkPermissions();
    if (perms.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }
  } catch {
    // уведомления не критичны для старта
  }
}

function sendLocationToServer(location) {
  const token = getNativeSessionToken();
  if (!token || !location) return;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const branchId = getStoredBranchId();
  if (branchId) headers['X-Branch-Id'] = branchId;

  CapacitorHttp.post({
    url: `${getApiBaseUrl()}/api/staff/location`,
    headers,
    data: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      source: 'android_bg',
    },
  }).catch(() => {});
}

export async function startBackgroundLocationTracking() {
  if (watcherId) return watcherId;

  await ensureNotificationPermission();

  watcherId = await BackgroundGeolocation.addWatcher(
    {
      backgroundMessage: 'Местоположение передаётся администратору. Нажмите, чтобы открыть приложение.',
      backgroundTitle: 'Снабжение — геолокация',
      requestPermissions: true,
      stale: false,
      distanceFilter: 30,
    },
    (location, error) => {
      if (error) return;
      sendLocationToServer(location);
    },
  );

  setBackgroundLocationEnabled(true);
  return watcherId;
}

export async function stopBackgroundLocationTracking() {
  if (!watcherId) return;
  try {
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
  } finally {
    watcherId = null;
    setBackgroundLocationEnabled(false);
  }
}

export function isBackgroundTrackingActive() {
  return !!watcherId;
}
