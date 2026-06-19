import { useState } from 'react';
import { useAuth } from '../AuthContext';
import { api } from '../api';
import { IconLock } from '../components/ActionIcons';

export default function ChangePassword() {
  const { user, logout, reload } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Новый пароль и подтверждение не совпадают');
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      await reload();
    } catch (err) {
      setError(err.message || 'Не удалось сменить пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-mark" aria-hidden><IconLock /></div>
          <div className="login-logo-text">
            Безопасность
            <span>Смена пароля</span>
          </div>
        </div>
        <h1>Установите новый пароль</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20, fontSize: 14 }}>
          {user?.name}, для продолжения работы смените пароль по умолчанию.
          Минимум 8 символов, не используйте простые пароли вроде admin123.
        </p>
        <form onSubmit={submit}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label>Текущий пароль</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="form-group">
            <label>Новый пароль</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="form-group">
            <label>Подтверждение</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? 'Сохранение...' : 'Сохранить пароль'}
          </button>
        </form>
        <button type="button" className="btn btn-ghost" style={{ marginTop: 12, width: '100%' }} onClick={logout}>
          Выйти
        </button>
      </div>
    </div>
  );
}
