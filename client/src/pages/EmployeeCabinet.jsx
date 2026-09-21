import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatMoney, formatDate } from '../api';

function formatClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '—';
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ledgerLabel(type) {
  if (type === 'accrue' || type === 'accrual') return 'Начисление';
  if (type === 'pay' || type === 'payout') return 'Выплата';
  return type || 'Операция';
}

export default function EmployeeCabinet({ embedded = false, backTo = '/', showBack = false }) {
  const { token } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const req = embedded ? api.getMyPayrollCabinet() : api.getPayrollCabinet(token);
    req
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setData(null);
          setError(err.message || (embedded ? 'Кабинет не найден' : 'Ссылка недействительна'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token, embedded]);

  const rating = Number(data?.month?.rating) || 0;

  return (
    <div className={`emp-cabinet${embedded ? ' is-embedded' : ''}`}>
      {embedded ? (
        showBack ? (
          <header className="emp-cabinet-embed-bar">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(backTo)}>
              ← Назад
            </button>
            <strong>Мой кабинет</strong>
          </header>
        ) : null
      ) : (
        <header className="emp-cabinet-top">
          <div className="emp-cabinet-brand">Mahalla</div>
          <div className="emp-cabinet-title">Мой кабинет</div>
        </header>
      )}

      <main className="emp-cabinet-body">
        {loading && <p className="emp-cabinet-empty">Загрузка…</p>}
        {error && !loading && (
          <div className="emp-cabinet-card">
            <p className="emp-cabinet-error">{error}</p>
            <p className="form-hint">
              {embedded
                ? 'Если вы есть в списке зарплаты, попросите администратора привязать ваш логин к ФИО.'
                : 'Обратитесь к администратору за новой ссылкой.'}
            </p>
          </div>
        )}
        {data && !loading && (
          <>
            <section className="emp-cabinet-card emp-cabinet-hero">
              <h1>{data.full_name}</h1>
              <p>
                {[data.position, data.department].filter(Boolean).join(' · ') || 'Сотрудник'}
              </p>
              {data.branch_name && <p className="emp-cabinet-branch">{data.branch_name}</p>}
            </section>

            <section className="emp-cabinet-kpis">
              <div className="emp-cabinet-kpi">
                <span>Долг</span>
                <strong>{formatMoney(data.balance || 0)}</strong>
              </div>
              <div className="emp-cabinet-kpi">
                <span>Оклад</span>
                <strong>{Number(data.base_salary) > 0 ? formatMoney(data.base_salary) : '—'}</strong>
              </div>
              <div className="emp-cabinet-kpi">
                <span>Рейтинг явки</span>
                <strong>{rating}%</strong>
                <em>{data.month?.days_present || 0} дн. в этом месяце</em>
              </div>
            </section>

            <section className="emp-cabinet-card">
              <h2>Сегодня</h2>
              <div className="emp-cabinet-today">
                <div>
                  <span>Кириш</span>
                  <strong>{formatClock(data.today?.in_at)}</strong>
                </div>
                <div>
                  <span>Чиқиш</span>
                  <strong>{formatClock(data.today?.out_at)}</strong>
                </div>
              </div>
            </section>

            <section className="emp-cabinet-card">
              <h2>Начисления и выплаты</h2>
              {(data.ledger || []).length === 0 ? (
                <p className="emp-cabinet-empty">Пока нет операций</p>
              ) : (
                <ul className="emp-cabinet-ledger">
                  {data.ledger.map((row, idx) => (
                    <li key={`${row.created_at}-${idx}`}>
                      <div>
                        <strong>{ledgerLabel(row.entry_type)}</strong>
                        <span>{formatDate(row.date)}{row.comment ? ` · ${row.comment}` : ''}</span>
                      </div>
                      <div className={`emp-cabinet-amt is-${row.entry_type}`}>
                        {formatMoney(row.amount)}
                        <small>остаток {formatMoney(row.balance_after)}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
