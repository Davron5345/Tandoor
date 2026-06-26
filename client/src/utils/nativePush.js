import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { isNativeApp } from './nativeApp';

const FCM_SUBSCRIBED_KEY = 'warehouse_fcm_subscribed';
const PUSH_PENDING_KEY = 'warehouse_push_pending';
const MIN_PUSH_BUILD = 7;

let listenersAttached = false;
let pendingRegistration = null;

export function isNativePushPluginAvailable() {
  return isNativeApp() && Capacitor.isPluginAvailable('PushNotifications');
}

export function getNativePushBlockReason(installedBuild = 0) {
  if (!isNativeApp()) return null;
  if ((installedBuild || 0) < MIN_PUSH_BUILD || !isNativePushPluginAvailable()) {
    return 'Обновите APK — кнопка «Обновить APK» вверху (нужен build 7 или новее)';
  }
  return null;
}

function attachPushListeners(api) {
  if (listenersAttached) return;
  listenersAttached = true;

  PushNotifications.addListener('registration', async (token) => {
    if (pendingRegistration) {
      const { resolve, reject } = pendingRegistration;
      pendingRegistration = null;
      try {
        await api.subscribePush({ type: 'fcm', token: token.value });
        localStorage.setItem(FCM_SUBSCRIBED_KEY, '1');
        sessionStorage.removeItem(PUSH_PENDING_KEY);
        resolve(token);
      } catch (err) {
        reject(err);
      }
      return;
    }
    try {
      await api.subscribePush({ type: 'fcm', token: token.value });
      localStorage.setItem(FCM_SUBSCRIBED_KEY, '1');
      sessionStorage.removeItem(PUSH_PENDING_KEY);
    } catch {
      // ignore background refresh
    }
  });

  PushNotifications.addListener('registrationError', (err) => {
    sessionStorage.removeItem(PUSH_PENDING_KEY);
    if (!pendingRegistration) return;
    const { reject } = pendingRegistration;
    pendingRegistration = null;
    reject(new Error(err?.error || 'Не удалось зарегистрировать уведомления'));
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action.notification?.data?.url;
    if (!url || typeof window === 'undefined') return;
    const target = url.startsWith('http') ? url : `${window.location.origin}${url}`;
    window.location.href = target;
  });
}

async function completeNativePushRegistration(api) {
  attachPushListeners(api);

  const registrationPromise = new Promise((resolve, reject) => {
    pendingRegistration = { resolve, reject };
    window.setTimeout(() => {
      if (!pendingRegistration) return;
      pendingRegistration = null;
      reject(new Error('Не удалось подключить уведомления. Перезапустите приложение и попробуйте снова.'));
    }, 20000);
  });

  await PushNotifications.register();
  await registrationPromise;
}

export async function subscribeNativePush(api, installedBuild = 0) {
  if (!isNativeApp()) {
    throw new Error('Только для Android-приложения');
  }

  const blockReason = getNativePushBlockReason(installedBuild);
  if (blockReason) {
    throw new Error(blockReason);
  }

  attachPushListeners(api);

  let perms = await PushNotifications.checkPermissions();
  if (perms.receive !== 'granted') {
    sessionStorage.setItem(PUSH_PENDING_KEY, '1');
    perms = await PushNotifications.requestPermissions();
    if (perms.receive !== 'granted') {
      sessionStorage.removeItem(PUSH_PENDING_KEY);
      throw new Error('Разрешите уведомления — без этого админ не сможет присылать сообщения');
    }
  }

  await completeNativePushRegistration(api);
}

/** После диалога разрешений Android перезагружает WebView — дозавершаем регистрацию */
export async function resumeNativePushIfNeeded(api, installedBuild = 0) {
  if (!isNativeApp() || getNativePushBlockReason(installedBuild)) return false;
  if (localStorage.getItem(FCM_SUBSCRIBED_KEY) === '1') return false;

  const pending = sessionStorage.getItem(PUSH_PENDING_KEY) === '1';
  const perms = await PushNotifications.checkPermissions();
  if (!pending && perms.receive !== 'granted') return false;

  try {
    await completeNativePushRegistration(api);
    return true;
  } catch {
    sessionStorage.removeItem(PUSH_PENDING_KEY);
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
    const perms = await PushNotifications.checkPermissions();
    if (perms.receive === 'granted') permission = 'granted';
    else if (perms.receive === 'denied') permission = 'denied';
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
