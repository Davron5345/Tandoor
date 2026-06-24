import { useCallback, useEffect, useState, lazy, Suspense } from 'react';
import { api } from '../api';
import { useToast } from '../components/Modal';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { todayLocalIso } from '../utils/date';

const StaffRouteMap = lazy(() => import('../components/StaffRouteMap'));

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

export default function StaffTracking({ embedded = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [draft, setDraft] = useState('');
  const [routeUserId, setRouteUserId] = useState('');
  const [routeUsername, setRouteUsername] = useState('');
  const [routeDate, setRouteDate] = useState(todayLocalIso());
  const [routeTimeFrom, setRouteTimeFrom] = useState('08:00');
  const [routeTimeTo, setRouteTimeTo] = useState('22:00');
  const [routeData, setRouteData] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const { show, Toast } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    api.getStaffLocations(username ? { username } : {})
      .then(setItems)
      .catch((e) => show(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [username, show]);

  const loadRoute = useCallback(async (userId, options = {}) => {
    if (!userId) return;
    setRouteLoading(true);
    try {
      const data = await api.getStaffLocationHistory({
        user_id: userId,
        date: options.date ?? routeDate,
        time_from: options.time_from ?? routeTimeFrom,
        time_to: options.time_to ?? routeTimeTo,
      });
      setRouteData(data);
    } catch (e) {
      show(e.message, 'error');
      setRouteData(null);
    } finally {
      setRouteLoading(false);
    }
  }, [routeDate, routeTimeFrom, routeTimeTo, show]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, [username], { intervalMs: 60_000 });

  const openRoute = (row) => {
    setRouteUserId(row.user_id);
    setRouteUsername(row.username);
    loadRoute(row.user_id);
  };

  const applyRouteFilters = () => {
    if (!routeUserId) return;
    loadRoute(routeUserId);
  };

  return (
    <div>
      {Toast}
      {!embedded && (
        <div className="page-header">
          <h1>Трекинг снабженцев</h1>
        </div>
      )}

      <div className="card filter-panel">
        <div className="filter-panel-row staff-tracking-filters">
          <label className="filter-field staff-tracking-search">
            <span className="filter-field-caption">Сотрудник</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Логин"
            />
          </label>
          <div className="filter-field filter-field-actions">
            <span className="filter-field-caption filter-field-caption-spacer" aria-hidden="true">&#8203;</span>
            <div className="filter-actions-buttons">
              <button type="button" className="btn btn-primary" onClick={() => setUsername(draft.trim())}>
                Применить
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { setDraft(''); setUsername(''); }}>
                Сбросить
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="security-locations-hint">
        Сотрудники с включённой геолокацией в приложении «Снабжение». Нажмите «Маршрут», чтобы увидеть путь за день.
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
                <th>Источник</th>
                <th>Координаты</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="empty">Загрузка...</td></tr>}
              {!loading && items.map((row) => (
                <tr key={row.user_id} className={routeUserId === row.user_id ? 'security-row-current' : ''}>
                  <td>
                    <strong>{row.username}</strong>
                    {row.user_name && row.user_name !== row.username && (
                      <div className="text-muted-sm">{row.user_name}</div>
                    )}
                  </td>
                  <td>{row.branch_name || '—'}</td>
                  <td>{formatDateTime(row.recorded_at)}</td>
                  <td>{row.accuracy != null ? `±${Math.round(row.accuracy)} м` : '—'}</td>
                  <td>{row.source === 'android_bg' ? 'Android (фон)' : 'PWA'}</td>
                  <td className="security-coords">
                    {Number(row.latitude).toFixed(5)}, {Number(row.longitude).toFixed(5)}
                  </td>
                  <td>
                    <div className="security-actions-inner">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => openRoute(row)}>
                        Маршрут
                      </button>
                      <a
                        className="btn btn-ghost btn-sm"
                        href={row.maps_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Точка
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={7} className="empty">Нет данных о местоположении</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {routeUserId && (
        <div className="card staff-route-panel">
          <div className="staff-route-panel-header">
            <h2>Маршрут: {routeUsername}</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setRouteUserId(''); setRouteData(null); }}
            >
              Закрыть
            </button>
          </div>

          <div className="staff-route-filters">
            <label className="filter-field">
              <span className="filter-field-caption">Дата</span>
              <input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-field-caption">С</span>
              <input type="time" value={routeTimeFrom} onChange={(e) => setRouteTimeFrom(e.target.value)} />
            </label>
            <label className="filter-field">
              <span className="filter-field-caption">До</span>
              <input type="time" value={routeTimeTo} onChange={(e) => setRouteTimeTo(e.target.value)} />
            </label>
            <div className="filter-field filter-field-actions">
              <span className="filter-field-caption filter-field-caption-spacer" aria-hidden="true">&#8203;</span>
              <button type="button" className="btn btn-primary" onClick={applyRouteFilters} disabled={routeLoading}>
                {routeLoading ? 'Загрузка...' : 'Показать'}
              </button>
            </div>
          </div>

          <p className="security-locations-hint">
            Зелёная точка — начало, красная — конец, синяя линия — путь за выбранный период.
            {routeData?.points?.length ? ` Точек: ${routeData.points.length}.` : ''}
          </p>

          {routeLoading ? (
            <div className="empty">Загрузка маршрута...</div>
          ) : (
            <Suspense fallback={<div className="empty">Загрузка карты...</div>}>
              <StaffRouteMap points={routeData?.points || []} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
