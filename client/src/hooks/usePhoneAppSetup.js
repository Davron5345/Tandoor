import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { isNativeApp } from '../utils/nativeApp';
import {
  getPushSubscriptionState,
  isPushSupported,
  isStandaloneApp,
  registerServiceWorker,
  setPwaManifestStartUrl,
  subscribeToPush,
} from '../utils/pwaPush';

const DISMISS_INSTALL_KEY = 'phone_app_dismiss_install_v1';
const DISMISS_PUSH_KEY = 'phone_app_dismiss_push_v1';

function readDismissed(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

/** Установка PWA и Web Push на телефонных экранах после входа по ссылке. */
export function usePhoneAppSetup({ startUrl = '/', enabled = true } = {}) {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pushState, setPushState] = useState({
    supported: false,
    subscribed: false,
    standalone: false,
  });
  const [pushLoading, setPushLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [installDismissed, setInstallDismissed] = useState(() => readDismissed(DISMISS_INSTALL_KEY));
  const [pushDismissed, setPushDismissed] = useState(() => readDismissed(DISMISS_PUSH_KEY));

  const refreshPushState = useCallback(async () => {
    try {
      const state = await getPushSubscriptionState();
      setPushState(state);
      return state;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || isNativeApp()) return undefined;
    setPwaManifestStartUrl(startUrl);
    registerServiceWorker();
    refreshPushState();
    return undefined;
  }, [enabled, startUrl, refreshPushState]);

  useEffect(() => {
    if (!enabled || isNativeApp()) return undefined;
    const onInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    return () => window.removeEventListener('beforeinstallprompt', onInstall);
  }, [enabled]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const standalone = isStandaloneApp() || !!pushState.standalone;
  const needsInstall = !isNativeApp() && !standalone && !installDismissed;
  const needsPush = !pushState.blockReason
    && isPushSupported()
    && !pushState.subscribed
    && !pushDismissed;
  const visible = enabled && !isNativeApp() && (needsInstall || needsPush);

  const iosHint = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua) && !standalone;
  }, [standalone]);

  const install = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
    if (choice?.outcome === 'accepted') {
      setInstallDismissed(true);
      writeDismissed(DISMISS_INSTALL_KEY);
      setNotice('Приложение установлено');
      return true;
    }
    return false;
  }, [installPrompt]);

  const enablePush = useCallback(async () => {
    setPushLoading(true);
    try {
      await subscribeToPush(api);
      await refreshPushState();
      setPushDismissed(true);
      writeDismissed(DISMISS_PUSH_KEY);
      setNotice('Уведомления включены');
      return true;
    } catch (err) {
      setNotice(err.message || 'Не удалось включить уведомления');
      return false;
    } finally {
      setPushLoading(false);
    }
  }, [refreshPushState]);

  const dismissInstall = useCallback(() => {
    setInstallDismissed(true);
    writeDismissed(DISMISS_INSTALL_KEY);
  }, []);

  const dismissPush = useCallback(() => {
    setPushDismissed(true);
    writeDismissed(DISMISS_PUSH_KEY);
  }, []);

  const dismissAll = useCallback(() => {
    dismissInstall();
    dismissPush();
  }, [dismissInstall, dismissPush]);

  return {
    visible,
    needsInstall,
    needsPush,
    installPrompt,
    iosHint,
    pushState,
    pushLoading,
    notice,
    setNotice,
    install,
    enablePush,
    dismissInstall,
    dismissPush,
    dismissAll,
    refreshPushState,
    standalone,
  };
}
