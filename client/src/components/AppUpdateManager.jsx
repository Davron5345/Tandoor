import { useEffect, useRef, useState } from 'react';
import { APP_BUILD_ID } from '../appBuildId';
import { getOpenModalCount, subscribeOpenModalCount } from '../modalRegistry';

const POLL_MS = 60_000;
const RELOAD_DELAY_MS = 600;
const RELOAD_GUARD_KEY = 'warehouse-app-update-reload';

async function fetchServerVersion() {
  const res = await fetch('/api/app-version', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.version || null;
}

export default function AppUpdateManager() {
  const pendingRef = useRef(false);
  const reloadingRef = useRef(false);
  const waitedForModalRef = useRef(false);
  const [modalCount, setModalCount] = useState(0);
  const [banner, setBanner] = useState(null);

  useEffect(() => subscribeOpenModalCount(setModalCount), []);

  const reloadApp = (message, serverVersion) => {
    if (reloadingRef.current) return;
    try {
      const lastReloadFor = sessionStorage.getItem(RELOAD_GUARD_KEY);
      if (lastReloadFor && lastReloadFor === serverVersion) {
        setBanner('Доступна новая версия. Нажмите Ctrl+F5 или очистите кэш браузера.');
        pendingRef.current = false;
        return;
      }
      if (serverVersion) sessionStorage.setItem(RELOAD_GUARD_KEY, serverVersion);
    } catch {
      /* ignore */
    }
    reloadingRef.current = true;
    setBanner(message);
    window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('_v', String(Date.now()));
      window.location.replace(url.toString());
    }, RELOAD_DELAY_MS);
  };

  const applyPendingUpdate = (serverVersion) => {
    if (!pendingRef.current || reloadingRef.current) return;
    if (getOpenModalCount() > 0) {
      waitedForModalRef.current = true;
      setBanner('Доступна новая версия. Обновим автоматически после закрытия окна.');
      return;
    }
    reloadApp(
      waitedForModalRef.current
        ? 'Обновляем до последней версии…'
        : 'Доступна новая версия. Обновляем…',
      serverVersion,
    );
  };

  useEffect(() => {
    if (import.meta.env.DEV) return undefined;

    let cancelled = false;

    const check = async () => {
      try {
        const serverVersion = await fetchServerVersion();
        if (cancelled || !serverVersion || serverVersion === APP_BUILD_ID) return;
        pendingRef.current = true;
        applyPendingUpdate(serverVersion);
      } catch {
        /* ignore network errors */
      }
    };

    check();
    const timer = window.setInterval(check, POLL_MS);
    const onFocus = () => { check(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!pendingRef.current) return;
    fetchServerVersion().then((serverVersion) => {
      if (serverVersion) applyPendingUpdate(serverVersion);
    });
  }, [modalCount]);

  if (!banner) return null;

  return (
    <div className="app-update-banner" role="status" aria-live="polite">
      {banner}
    </div>
  );
}
