import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { phoneHomePath } from '../permissions';

export default function EmployeeLogin() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.loginByLink(token);
        if (cancelled) return;
        navigate(data.home || phoneHomePath(data.user), { replace: true });
      } catch (err) {
        if (!cancelled) setError(err.message || 'Ссылка недействительна');
      }
    })();
    return () => { cancelled = true; };
  }, [token, navigate]);

  return (
    <div className="login-page employee-login-page">
      <div className="login-card">
        <h1 className="login-title">Вход</h1>
        {error ? (
          <>
            <div className="alert alert-error">{error}</div>
            <p className="form-hint">Обратитесь к администратору за новой ссылкой.</p>
          </>
        ) : (
          <p className="form-hint">Входим в систему…</p>
        )}
      </div>
    </div>
  );
}
