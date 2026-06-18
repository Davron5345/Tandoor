const STORAGE_KEY = 'warehouse-theme';

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}
