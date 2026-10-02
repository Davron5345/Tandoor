import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  const login = async (username, password, remember = false) => {
    const data = await api.login(username, password, remember);
    setUser(data.user);
    return data.user;
  };

  const loginByLink = useCallback(async (token) => {
    const data = await api.loginByLink(token);
    setUser(data.user);
    setLoading(false);
    return data;
  }, []);

  const logout = async () => {
    // Иначе push этого телефона продолжит приходить вышедшему сотруднику
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      const subscription = await registration?.pushManager?.getSubscription?.();
      if (subscription?.endpoint) await api.unsubscribePush(subscription.endpoint);
    } catch {
      // нет прав на push или SW — подписки и не было
    }
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginByLink, logout, reload: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
