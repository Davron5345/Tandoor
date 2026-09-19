const STORAGE_KEY = 'warehouse-theme';

export function getStoredTheme() {
  try {
    const theme = localStorage.getItem(STORAGE_KEY);
    return theme === 'light' || theme === 'dark' ? theme : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  const safeTheme = theme === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.setAttribute('data-theme', safeTheme);
  root.style.colorScheme = safeTheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    let phone = false;
    let standalone = false;
    try {
      phone = window.matchMedia('(max-width: 768px)').matches;
      standalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    } catch {
      /* ignore */
    }
    if (phone || standalone || safeTheme === 'light') {
      meta.setAttribute('content', '#f5c518');
    } else {
      meta.setAttribute('content', '#0f1419');
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, safeTheme);
  } catch {
    // ignore
  }
}
