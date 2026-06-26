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
    meta.setAttribute('content', safeTheme === 'dark' ? '#0f1419' : '#2563eb');
  }
  try {
    localStorage.setItem(STORAGE_KEY, safeTheme);
  } catch {
    // ignore
  }
}
