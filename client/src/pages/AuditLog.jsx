import { useEffect, useState } from 'react';
import { api } from '../api';
import { DOC_TYPE_LABELS } from '../permissions';

const ACTION_LABELS = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'auth.change_password': 'Смена пароля',
  'document.confirm': 'Проведение документа',
  'document.cancel': 'Отмена документа',
};

function formatDateTime(value) {
  if (!value) return '—';
  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (match) {
    const [, y, m, d, hh = '00', mm = '00'] = match;
    return `${d}.${m}.${y} ${hh}:${mm}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mo}.${yyyy} ${hh}:${mm}`;
}

function formatDetails(row) {
  const parts = [];
  if (row.entity_type && row.entity_id) {
    parts.push(`${row.entity_type}: ${row.entity_id.slice(0, 8)}…`);
  }
  if (row.meta && typeof row.meta === 'object') {
    if (row.meta.type) {
      parts.push(DOC_TYPE_LABELS[row.meta.type] || row.meta.type);
    }
    if (row.meta.number) {
      parts.push(`№ ${row.meta.number}`);
    }
    if (row.meta.via) {
      parts.push(`(${row.meta.via})`);
    }
  } else if (row.meta) {
    parts.push(String(row.meta));
  }
  return parts.length ? parts.join(' · ') : '—';
}

const emptyFilters = {
  action: '',
  username: '',
  date_from: '',
  date_to: '',
};

export default function AuditLog() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [draft, setDraft] = useState(emptyFilters);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await api.getAuditLog({ ...filters, page, limit: 50 });
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        setPages(result.pages);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page, filters]);

  const applyFilters = () => {
    setPage(1);
    setFilters({ ...draft });
  };

  const resetFilters = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setPage(1);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Журнал аудита</h1>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            Действие
            <select
              value={draft.action}
              onChange={(e) => setDraft((f) => ({ ...f, action: e.target.value }))}
            >
              <option value="">Все</option>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            Пользователь
            <input
              type="text"
              placeholder="Логин"
              value={draft.username}
              onChange={(e) => setDraft((f) => ({ ...f, username: e.target.value }))}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            С даты
            <input
              type="date"
              value={draft.date_from}
              onChange={(e) => setDraft((f) => ({ ...f, date_from: e.target.value }))}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            По дату
            <input
              type="date"
              value={draft.date_to}
              onChange={(e) => setDraft((f) => ({ ...f, date_to: e.target.value }))}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={applyFilters}>Применить</button>
          <button type="button" className="btn btn-ghost" onClick={resetFilters}>Сбросить</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата и время</th>
                <th>Пользователь</th>
                <th>Действие</th>
                <th>Детали</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="empty">Загрузка...</td></tr>
              )}
              {!loading && items.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{row.username || '—'}</td>
                  <td>{row.action_label || ACTION_LABELS[row.action] || row.action}</td>
                  <td>{formatDetails(row)}</td>
                  <td>{row.ip || '—'}</td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5} className="empty">Записей нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="table-pagination" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', justifyContent: 'flex-end' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {total} записей · стр. {page} из {pages}
            </span>
            <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Назад
            </button>
            <button type="button" className="btn btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Вперёд →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
