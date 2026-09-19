const ALLOWED_START = new Set([
  '/',
  '/cashier',
  '/warehouse/orders',
  '/warehouse/prihod',
  '/warehouse/transfer',
  '/snab',
]);

export function buildWebManifest({ startUrl = '/', name = 'Mahalla', shortName = 'Mahalla' } = {}) {
  const start = ALLOWED_START.has(startUrl) ? startUrl : '/';
  return {
    name,
    short_name: shortName,
    description: 'Учёт, касса и снабжение Mahalla — вход с телефона',
    start_url: start,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#eceff1',
    theme_color: '#f5c518',
    lang: 'ru',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}

export function isAllowedManifestStart(path) {
  return ALLOWED_START.has(path);
}
