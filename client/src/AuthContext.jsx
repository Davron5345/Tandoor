import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setAuthToken } from './api';

const AuthContext = createContext(null);
const TOKEN_KEY = 'warehouse-auth-token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setUser(null);
      setAuthToken(null);
      setLoading(false);
      return;
    }
    setAuthToken(token);
    try {
      const me = await api.getMe();
      setUser(me);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUser(); }, [loadUser]);

  const login = async (username, password) => {
    const data = await api.login(username, password);
    localStorage.setItem(TOKEN_KEY, data.token);
    setAuthToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, reload: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
