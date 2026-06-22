import { useEffect, useRef } from 'react';
import { api } from '../api';

const PING_INTERVAL_MS = 3 * 60 * 1000;

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Геолокация не поддерживается'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60_000 },
    );
  });
}

export function useStaffLocationPing(enabled = true) {
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

    const ping = async () => {
      if (document.hidden || busyRef.current) return;
      busyRef.current = true;
      try {
        const pos = await getCurrentPosition();
        await api.sendStaffLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          source: 'pwa',
        });
      } catch {
        // пользователь мог отклонить геолокацию — не мешаем работе
      } finally {
        busyRef.current = false;
      }
    };

    ping();
    const timer = setInterval(ping, PING_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) ping();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}

export async function requestStaffLocationPermission() {
  const pos = await getCurrentPosition();
  return api.sendStaffLocation({
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    source: 'pwa',
  });
}
