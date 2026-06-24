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
  document.documentElement.setAttribute('data-theme', safeTheme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}
