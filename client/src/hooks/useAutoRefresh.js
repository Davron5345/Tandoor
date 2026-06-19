import { useEffect, useRef } from 'react';

/** Интервал фонового обновления списков (мс). */
export const LIVE_REFRESH_INTERVAL_MS = 15_000;

/**
 * Периодически вызывает load, пока вкладка активна.
 * При возврате в окно / вкладку — сразу обновляет данные.
 */
export function useAutoRefresh(load, deps = [], options = {}) {
  const {
    intervalMs = LIVE_REFRESH_INTERVAL_MS,
    enabled = true,
    refreshOnFocus = true,
  } = options;

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (document.hidden) return;
      loadRef.current();
    };

    const intervalId = setInterval(tick, intervalMs);

    const onVisibility = () => {
      if (!document.hidden) loadRef.current();
    };

    const onFocus = () => {
      loadRef.current();
    };

    if (refreshOnFocus) {
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onFocus);
    }

    return () => {
      clearInterval(intervalId);
      if (refreshOnFocus) {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезапуск при смене филиала / фильтров
  }, [intervalMs, refreshOnFocus, enabled, ...deps]);
}
