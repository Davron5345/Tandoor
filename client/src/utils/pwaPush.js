import { isNativeApp } from './nativeApp';
import {
  getNativePushBlockReason,
  getNativePushState,
  markNativePushSubscribed,
  requestNativeNotificationPermission,
  resumeNativePushIfNeeded,
} from './nativePush';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

const ALLOWED_MANIFEST_START = new Set([
  '/',
  '/cashier',
  '/warehouse/orders',
  '/warehouse/prihod',
  '/warehouse/transfer',
  '/snab',
]);

/** Меняет start_url манифеста, чтобы установленное приложение открывало нужный экран. */
export function setPwaManifestStartUrl(startUrl = '/') {
  if (typeof document === 'undefined') return;
  const start = ALLOWED_MANIFEST_START.has(startUrl) ? startUrl : '/';
  const href = `/api/app/web-manifest?start=${encodeURIComponent(start)}`;
  let link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) {
    link.setAttribute('href', href);
  }
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', 'Mahalla');
}

export function isPushSupported() {
  if (isNativeApp()) return true;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getPushBlockReason(installedBuild = 0) {
  if (isNativeApp()) {
    return getNativePushBlockReason(installedBuild);
  }
  if (!isPushSupported()) {
    return 'Браузер не поддерживает push-уведомления';
  }
  return null;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.ready.catch(() => null);
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.error('SW register failed', err);
    return null;
  }
}

async function subscribeWebPush(api) {
  const registration = await registerServiceWorker();
  if (!registration) {
    throw new Error('Не удалось зарегистрировать приложение — проверьте интернет');
  }
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.getPushPublicKey();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await api.subscribePush(subscription.toJSON());
  return subscription;
}

export async function subscribeToPush(api, installedBuild = 0) {
  if (isNativeApp()) {
    const blockReason = getNativePushBlockReason(installedBuild);
    if (blockReason) throw new Error(blockReason);

    await requestNativeNotificationPermission();

    if (isPushSupported()) {
      await subscribeWebPush(api);
      markNativePushSubscribed();
    } else {
      markNativePushSubscribed();
    }
    return null;
  }

  const blockReason = getPushBlockReason();
  if (blockReason) throw new Error(blockReason);
  if (!isPushSupported()) {
    throw new Error('Устройство не поддерживает push-уведомления');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Нажмите «Разрешить» в запросе уведомлений');
  }

  return subscribeWebPush(api);
}

/** @deprecated используйте subscribeToPush */
export async function subscribeToOrderPush(api, installedBuild = 0) {
  return subscribeToPush(api, installedBuild);
}

export { resumeNativePushIfNeeded } from './nativePush';

export async function getPushSubscriptionState(installedBuild = 0) {
  if (isNativeApp()) {
    return getNativePushState(installedBuild);
  }

  const blockReason = getPushBlockReason();
  if (!isPushSupported()) {
    return { supported: false, blockReason, subscribed: false };
  }
  const permission = Notification.permission;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return {
    supported: true,
    blockReason,
    permission,
    subscribed: !!subscription,
    standalone: isStandaloneApp(),
  };
}

export async function getNotificationPermission() {
  if (isNativeApp()) {
    const state = await getNativePushState();
    return state.permission;
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
