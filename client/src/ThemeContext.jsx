import { createContext, useContext, useEffect, useState } from 'react';
import { applyTheme, getStoredTheme } from './theme';
import { isStandaloneApp } from './utils/pwaPush';

const ThemeContext = createContext(null);

function resolveInitialTheme() {
  try {
    if (isStandaloneApp() || window.matchMedia('(max-width: 768px)').matches) {
      /* Телефон / PWA: всегда светлая 1С — тёмный фон давал чёрный экран */
      return 'light';
    }
  } catch {
    /* ignore */
  }
  return getStoredTheme();
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const syncPhoneLight = () => {
      if (isStandaloneApp() || window.matchMedia('(max-width: 768px)').matches) {
        setThemeState('light');
      }
    };
    syncPhoneLight();
    const mq = window.matchMedia('(max-width: 768px)');
    mq.addEventListener('change', syncPhoneLight);
    return () => mq.removeEventListener('change', syncPhoneLight);
  }, []);

  const setTheme = (next) => setThemeState(next);
  const toggleTheme = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
