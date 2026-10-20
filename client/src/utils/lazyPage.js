import { lazy } from 'react';

const RELOAD_KEY = 'warehouse-chunk-reload-at';

function isChunkLoadError(err) {
  const msg = String(err?.message || err || '');
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(msg);
}

/** После деплоя старые чанки удаляются — одна перезагрузка подтягивает свежий index.html. */
export function lazyPage(loader) {
  return lazy(() => loader().catch((err) => {
    if (typeof window !== 'undefined' && isChunkLoadError(err)) {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      if (Date.now() - last > 30_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
        window.location.reload();
        return new Promise(() => {});
      }
    }
    throw err;
  }));
}
