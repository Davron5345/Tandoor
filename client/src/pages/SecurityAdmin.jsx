import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Modal';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const TABS = [
  { id: 'sessions', label: 'Активные сеансы' },
  { id: 'locations', label: 'Где сотрудники' },
  { id: 'blocked', label: 'Заблокированные устройства' },
  { id: 'visits', label: 'Журнал посещений' },
];

function formatDateTime(value) {
  if (!value) return '—';
  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (match) {
    const [, , m, d, hh = '00', mm = '00'] = match;
    const y = match[1];
    return `${d}.${m}.${y} ${hh}:${mm}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function Pagination({ page, pages, total, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="table-pagination security-pagination">
      <span>{total} записей · стр. {page} из {pages}</span>
      <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Назад
      </button>
      <button type="button" className="btn btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Вперёд →
      </button>
    </div>
  );
}

function SessionsTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ username: '', ip: '' });
  const [draft, setDraft] = useState({ username: '', ip: '' });
  const { show, Toast } = useToast();

  const load = useCallback((options = {}) => {
    const { silent = false } = options;
    if (!silent) setLoading(true);
    return api.getAdminSessions({ ...filters, page, limit: 50 })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
        setPages(result.pages);
      })
      .catch((e) => show(e.message, 'error'))
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, [filters, page, show]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(() => load({ silent: true }), [filters, page], { intervalMs: 60_000 });

  const revoke = async (id) => {
    if (!window.confirm('Завершить этот сеанс?')) return;
    try {
      await api.revokeAdminSession(id);
      show('Сеанс завершён');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const blockDevice = async (session) => {
    const reason = window.prompt('Причина блокировки устройства (необязательно):', '');
    if (reason === null) return;
    if (!window.confirm(`Заблокировать устройство «${session.device_label}» и завершить все его сеансы?`)) return;
    try {
      await api.blockSessionDevice(session.id, reason);
      show('Устройство заблокировано');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const revokeAllForUser = async (userId, username) => {
    if (!window.confirm(`Завершить все сеансы пользователя «${username}»?`)) return;
    try {
      const result = await api.revokeUserSessions(userId);
      show(`Завершено сеансов: ${result.revoked}`);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <>
      {Toast}
      <div className="card filter-panel">
        <div className="filter-panel-row">
          <label className="filter-field">
            Пользователь
            <input
              value={draft.username}
              onChange={(e) => setDraft((f) => ({ ...f, username: e.target.value }))}
              placeholder="Логин"
            />
          </label>
          <label className="filter-field">
            IP
            <input
              value={draft.ip}
              onChange={(e) => setDraft((f) => ({ ...f, ip: e.target.value }))}
              placeholder="192.168..."
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => { setPage(1); setFilters({ ...draft }); }}>
            Применить
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setDraft({ username: '', ip: '' }); setFilters({ username: '', ip: '' }); setPage(1); }}>
            Сбросить
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="security-table">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Устройство</th>
                <th>IP</th>
                <th>Вход</th>
                <th>Активность</th>
                <th className="security-col-status">Статус</th>
                <th className="security-col-actions">Действия</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr><td colSpan={7} className="empty">Загрузка...</td></tr>
              )}
              {items.map((row) => (
                <tr key={row.id} className={row.is_current ? 'security-row-current' : ''}>
                  <td>
                    <strong>{row.username}</strong>
                    {row.user_name && row.user_name !== row.username && (
                      <div className="text-muted-sm">{row.user_name}</div>
                    )}
                  </td>
                  <td>{row.device_label}</td>
                  <td>{row.ip || '—'}</td>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{formatDateTime(row.last_seen_at)}</td>
                  <td className="security-col-status">
                    <div className="security-status-badges">
                      {row.is_current && <span className="badge badge-primary">Текущий</span>}
                      {!row.is_current && row.is_active && <span className="badge badge-success">Онлайн</span>}
                      {!row.is_current && !row.is_active && <span className="badge badge-muted">Неактивен</span>}
                      {row.remember && <span className="badge badge-muted">7 дней</span>}
                    </div>
                  </td>
                  <td className="security-col-actions">
                    <div className="security-actions-inner">
                      {!row.is_current && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(row.id)}>
                          Завершить
                        </button>
                      )}
                      {row.device_id && (
                        <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => blockDevice(row)}>
                          Заблокировать
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => revokeAllForUser(row.user_id, row.username)}
                        title="Завершить все сеансы пользователя"
                      >
                        Все сеансы
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && <tr><td colSpan={7} className="empty">Активных сеансов нет</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </>
  );
}

function BlockedTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const { show, Toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.getBlockedDevices({ page, limit: 50 })
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        setPages(result.pages);
      })
      .catch((e) => show(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [page, show]);

  useEffect(() => { load(); }, [load]);

  const unblock = async (id) => {
    if (!window.confirm('Разблокировать это устройство?')) return;
    try {
      await api.unblockDevice(id);
      show('Устройство разблокировано');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <>
      {Toast}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Устройство</th>
                <th>Пользователь</th>
                <th>IP</th>
                <th>Причина</th>
                <th>Заблокировал</th>
                <th>Дата</th>
                <th>До</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="empty">Загрузка...</td></tr>}
              {!loading && items.map((row) => (
                <tr key={row.id}>
                  <td>{row.device_label || row.device_id?.slice(0, 12) || '—'}</td>
                  <td>{row.user_username || '—'}</td>
                  <td>{row.ip || '—'}</td>
                  <td>{row.reason || '—'}</td>
                  <td>{row.blocked_by_username || '—'}</td>
                  <td>{formatDateTime(row.blocked_at)}</td>
                  <td>{row.expires_at ? formatDateTime(row.expires_at) : 'Навсегда'}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => unblock(row.id)}>
                      Разблокировать
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && <tr><td colSpan={8} className="empty">Заблокированных устройств нет</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </>
  );
}

function VisitsTab() {
  const [items, setItems] = useState([]);
  const [actions, setActions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const emptyFilters = { action: '', username: '', ip: '', success: '', date_from: '', date_to: '' };
  const [filters, setFilters] = useState(emptyFilters);
  const [draft, setDraft] = useState(emptyFilters);

  useEffect(() => {
    api.getVisitActions().then(setActions).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getVisitLog({ ...filters, page, limit: 50 })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setPage(result.page);
        setPages(result.pages);
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, page]);

  return (
    <>
      <div className="card filter-panel">
        <div className="filter-panel-row">
          <label className="filter-field">
            Действие
            <select value={draft.action} onChange={(e) => setDraft((f) => ({ ...f, action: e.target.value }))}>
              <option value="">Все</option>
              {actions.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            Пользователь
            <input value={draft.username} onChange={(e) => setDraft((f) => ({ ...f, username: e.target.value }))} placeholder="Логин" />
          </label>
          <label className="filter-field">
            IP
            <input value={draft.ip} onChange={(e) => setDraft((f) => ({ ...f, ip: e.target.value }))} placeholder="IP" />
          </label>
          <label className="filter-field">
            Результат
            <select value={draft.success} onChange={(e) => setDraft((f) => ({ ...f, success: e.target.value }))}>
              <option value="">Все</option>
              <option value="1">Успех</option>
              <option value="0">Отказ</option>
            </select>
          </label>
          <label className="filter-field">
            С даты
            <input type="date" value={draft.date_from} onChange={(e) => setDraft((f) => ({ ...f, date_from: e.target.value }))} />
          </label>
          <label className="filter-field">
            По дату
            <input type="date" value={draft.date_to} onChange={(e) => setDraft((f) => ({ ...f, date_to: e.target.value }))} />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => { setPage(1); setFilters({ ...draft }); }}>
            Применить
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setDraft(emptyFilters); setFilters(emptyFilters); setPage(1); }}>
            Сбросить
          </button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Пользователь</th>
                <th>Действие</th>
                <th>Результат</th>
                <th>Устройство</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="empty">Загрузка...</td></tr>}
              {!loading && items.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{row.username || '—'}</td>
                  <td>{row.action_label || row.action}</td>
                  <td>
                    <span className={`badge ${row.success ? 'badge-success' : 'badge-danger'}`}>
                      {row.success ? 'Успех' : 'Отказ'}
                    </span>
                  </td>
                  <td>{row.device_label || '—'}</td>
                  <td>{row.ip || '—'}</td>
                </tr>
              ))}
              {!loading && items.length === 0 && <tr><td colSpan={6} className="empty">Записей нет</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pages={pages} total={total} onPage={setPage} />
      </div>
    </>
  );
}

function LocationsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [draft, setDraft] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.getStaffLocations(username ? { username } : {})
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [username]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, [username], { intervalMs: 60_000 });

  return (
    <>
      <div className="card filter-panel">
        <div className="filter-panel-row">
          <label className="filter-field">
            Сотрудник
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Логин"
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setUsername(draft.trim())}>
            Применить
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setDraft(''); setUsername(''); }}>
            Сбросить
          </button>
        </div>
      </div>

      <p className="security-locations-hint">
        Показываются сотрудники, у которых открыто приложение «Снабжение» и разрешена геолокация (данные за последние 24 часа).
      </p>

      <div className="card">
        <div className="table-wrap">
          <table className="security-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Филиал</th>
                <th>Обновлено</th>
                <th>Точность</th>
                <th>Координаты</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="empty">Загрузка...</td></tr>}
              {!loading && items.map((row) => (
                <tr key={row.user_id}>
                  <td>
                    <strong>{row.username}</strong>
                    {row.user_name && row.user_name !== row.username && (
                      <div className="text-muted-sm">{row.user_name}</div>
                    )}
                  </td>
                  <td>{row.branch_name || '—'}</td>
                  <td>{formatDateTime(row.recorded_at)}</td>
                  <td>{row.accuracy != null ? `±${Math.round(row.accuracy)} м` : '—'}</td>
                  <td className="security-coords">
                    {Number(row.latitude).toFixed(5)}, {Number(row.longitude).toFixed(5)}
                  </td>
                  <td>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={row.maps_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      На карте
                    </a>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={6} className="empty">Нет данных о местоположении</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function SecurityAdmin() {
  const [tab, setTab] = useState('sessions');

  return (
    <div>
      <div className="page-header">
        <h1>Сеансы и безопасность</h1>
      </div>

      <div className="security-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`security-tab${tab === item.id ? ' active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'sessions' && <SessionsTab />}
      {tab === 'locations' && <LocationsTab />}
      {tab === 'blocked' && <BlockedTab />}
      {tab === 'visits' && <VisitsTab />}
    </div>
  );
}
