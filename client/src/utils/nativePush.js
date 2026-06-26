import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativeApp } from './nativeApp';

const FCM_SUBSCRIBED_KEY = 'warehouse_fcm_subscribed';
const PUSH_PENDING_KEY = 'warehouse_push_pending';
const MIN_PUSH_BUILD = 10;

export function isNativePushPluginAvailable() {
  return isNativeApp();
}

export function getNativePushBlockReason(installedBuild = 0) {
  if (!isNativeApp()) return null;
  if ((installedBuild || 0) < MIN_PUSH_BUILD) {
    return 'Обновите APK до build 10 — текущая версия устарела';
  }
  return null;
}

/** Запрос разрешения на уведомления через стандартный Android-диалог */
export async function requestNativeNotificationPermission() {
  const perms = await LocalNotifications.checkPermissions();
  if (perms.display === 'granted') return true;
  sessionStorage.setItem(PUSH_PENDING_KEY, '1');
  const requested = await LocalNotifications.requestPermissions();
  sessionStorage.removeItem(PUSH_PENDING_KEY);
  if (requested.display !== 'granted') {
    throw new Error('Разрешите уведомления — без этого админ не сможет присылать сообщения');
  }
  return true;
}

export async function resumeNativePushIfNeeded() {
  if (!isNativeApp()) return false;
  if (localStorage.getItem(FCM_SUBSCRIBED_KEY) === '1') return false;
  if (sessionStorage.getItem(PUSH_PENDING_KEY) !== '1') return false;
  try {
    const perms = await LocalNotifications.checkPermissions();
    return perms.display === 'granted';
  } catch {
    return false;
  }
}

export async function getNativePushState(installedBuild = 0) {
  if (!isNativeApp()) {
    return { supported: false, subscribed: false, blockReason: null };
  }

  const blockReason = getNativePushBlockReason(installedBuild);
  if (blockReason) {
    return {
      supported: false,
      blockReason,
      permission: 'default',
      subscribed: false,
      standalone: true,
    };
  }

  let permission = 'default';
  try {
    const perms = await LocalNotifications.checkPermissions();
    if (perms.display === 'granted') permission = 'granted';
    else if (perms.display === 'denied') permission = 'denied';
  } catch {
    // ignore
  }

  let subscribed = false;
  try {
    subscribed = localStorage.getItem(FCM_SUBSCRIBED_KEY) === '1';
  } catch {
    // ignore
  }

  return {
    supported: true,
    blockReason: null,
    permission,
    subscribed,
    standalone: true,
  };
}

export function markNativePushSubscribed() {
  try {
    localStorage.setItem(FCM_SUBSCRIBED_KEY, '1');
  } catch {
    // ignore
  }
}
