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

const DISMISS_INSTALL_KEY = 'phone_app_dismiss_install_v2';
const DISMISS_PUSH_KEY = 'phone_app_dismiss_push_v2';

function readSessionDismissed(key) {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeSessionDismissed(key) {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
}

function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
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
  const [installDismissed, setInstallDismissed] = useState(() => readSessionDismissed(DISMISS_INSTALL_KEY));
  const [pushDismissed, setPushDismissed] = useState(() => readSessionDismissed(DISMISS_PUSH_KEY));

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
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const standalone = isStandaloneApp() || !!pushState.standalone;
  const ios = useMemo(() => isIosDevice(), []);
  const needsInstall = !isNativeApp() && !standalone && !installDismissed;
  // На iOS Web Push работает только из установленного PWA
  const pushAllowed = !ios || standalone;
  const needsPush = pushAllowed
    && !pushState.blockReason
    && isPushSupported()
    && !pushState.subscribed
    && !pushDismissed;
  // Один шаг за раз: сначала установка, потом уведомления
  const step = needsInstall ? 'install' : (needsPush ? 'push' : null);
  const visible = enabled && !isNativeApp() && !!step;

  const install = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    setInstallPrompt(null);
    if (choice?.outcome === 'accepted') {
      setInstallDismissed(true);
      writeSessionDismissed(DISMISS_INSTALL_KEY);
      setNotice('Готово — откройте с домашнего экрана');
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
      writeSessionDismissed(DISMISS_PUSH_KEY);
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
    writeSessionDismissed(DISMISS_INSTALL_KEY);
  }, []);

  const dismissPush = useCallback(() => {
    setPushDismissed(true);
    writeSessionDismissed(DISMISS_PUSH_KEY);
  }, []);

  const dismissCurrent = useCallback(() => {
    if (step === 'install') dismissInstall();
    else if (step === 'push') dismissPush();
  }, [step, dismissInstall, dismissPush]);

  const dismissAll = useCallback(() => {
    dismissInstall();
    dismissPush();
  }, [dismissInstall, dismissPush]);

  return {
    visible,
    step,
    needsInstall,
    needsPush,
    installPrompt,
    ios,
    iosHint: ios && !standalone,
    pushState,
    pushLoading,
    notice,
    setNotice,
    install,
    enablePush,
    dismissInstall,
    dismissPush,
    dismissCurrent,
    dismissAll,
    refreshPushState,
    standalone,
  };
}
