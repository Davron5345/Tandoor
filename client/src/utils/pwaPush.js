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

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.error('SW register failed', err);
    return null;
  }
}

export async function getNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function subscribeToOrderPush(api) {
  if (!isPushSupported()) {
    throw new Error('Браузер не поддерживает push-уведомления');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Разрешите уведомления в настройках браузера');
  }

  const registration = await registerServiceWorker();
  if (!registration) {
    throw new Error('Не удалось зарегистрировать приложение');
  }

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

export async function getPushSubscriptionState() {
  if (!isPushSupported()) return { supported: false };
  const permission = Notification.permission;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return {
    supported: true,
    permission,
    subscribed: !!subscription,
    standalone: isStandaloneApp(),
  };
}
