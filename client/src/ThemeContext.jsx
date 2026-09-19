import { createContext, useContext, useEffect, useState } from 'react';
import { applyTheme, getStoredTheme } from './theme';

const ThemeContext = createContext(null);

function isPhoneOrStandalone() {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(max-width: 768px)').matches
      || window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

function resolveInitialTheme() {
  if (isPhoneOrStandalone()) return 'light';
  return getStoredTheme();
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const syncPhoneLight = () => {
      if (isPhoneOrStandalone()) setThemeState('light');
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
