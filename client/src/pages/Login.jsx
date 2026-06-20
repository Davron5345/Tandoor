import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { useTheme } from '../ThemeContext';
import { IconEye, IconEyeOff } from '../components/ActionIcons';
import { IconNavMoon, IconNavSun } from '../components/NavIcons';

const TEST_ACCOUNTS = [
  { username: 'admin', password: 'admin123', label: 'Администратор' },
  { username: 'sklad', password: 'sklad123', label: 'Завсклад' },
  { username: 'kassir', password: 'kassir123', label: 'Кассир' },
];

const isDev = import.meta.env.DEV;

export default function Login() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  const fillAccount = (acc) => {
    setUsername(acc.username);
    setPassword(acc.password);
    setError('');
  };

  return (
    <div className="login-page">
      <button
        type="button"
        className="theme-toggle login-theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      >
        {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
      </button>
      <div className="login-card">
        <h1 className="login-title">Вход в систему</h1>
        <form onSubmit={submit}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label>Логин</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder={isDev ? 'admin' : ''}
              required
            />
          </div>
          <div className="form-group">
            <label>Пароль</label>
            <div className="login-password-field">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder={isDev ? 'admin123' : ''}
                required
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPass(!showPass)}
                title={showPass ? 'Скрыть' : 'Показать'}
                aria-label={showPass ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPass ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
        {isDev && (
          <div className="login-hint">
            <p><strong>Тестовые аккаунты</strong> (нажмите для автозаполнения):</p>
            {TEST_ACCOUNTS.map((acc) => (
              <button
                key={acc.username}
                type="button"
                className="login-account-btn"
                onClick={() => fillAccount(acc)}
              >
                <strong>{acc.username}</strong> / {acc.password} — {acc.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
