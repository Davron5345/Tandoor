import { PushNotifications } from '@capacitor/push-notifications';
import { isNativeApp } from './nativeApp';

const FCM_SUBSCRIBED_KEY = 'warehouse_fcm_subscribed';

let listenersAttached = false;
let pendingRegistration = null;

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
        resolve(token);
      } catch (err) {
        reject(err);
      }
      return;
    }
    try {
      await api.subscribePush({ type: 'fcm', token: token.value });
      localStorage.setItem(FCM_SUBSCRIBED_KEY, '1');
    } catch {
      // ignore background refresh
    }
  });

  PushNotifications.addListener('registrationError', (err) => {
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

export async function subscribeNativePush(api) {
  if (!isNativeApp()) {
    throw new Error('Только для Android-приложения');
  }

  attachPushListeners(api);

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') {
    throw new Error('Разрешите уведомления — без этого админ не сможет присылать сообщения');
  }

  const registrationPromise = new Promise((resolve, reject) => {
    pendingRegistration = { resolve, reject };
    window.setTimeout(() => {
      if (!pendingRegistration) return;
      pendingRegistration = null;
      reject(new Error('Не удалось подключить уведомления. Перезапустите приложение и попробуйте снова.'));
    }, 15000);
  });

  await PushNotifications.register();
  await registrationPromise;
}

export async function getNativePushState() {
  if (!isNativeApp()) {
    return { supported: false, subscribed: false, blockReason: null };
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
