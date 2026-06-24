import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Modal';

export default function AdminPushTab() {
  const [branches, setBranches] = useState([]);
  const [subscribers, setSubscribers] = useState({ items: [], total: 0, subscriptions: 0 });
  const [loading, setLoading] = useState(true);
  const [pushReady, setPushReady] = useState(true);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    title: '',
    body: '',
    url: '/snab',
    branch_id: '',
    target: 'snab',
  });
  const { show, Toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchList, subs] = await Promise.all([
        api.getBranches(),
        api.getAdminPushSubscribers(form.branch_id ? { branch_id: form.branch_id } : {}),
      ]);
      setBranches(branchList);
      setSubscribers(subs);
      setPushReady(true);
    } catch (e) {
      if (String(e.message || '').includes('не настроены')) {
        setPushReady(false);
        setSubscribers({ items: [], total: 0, subscriptions: 0 });
      } else {
        show(e.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [form.branch_id, show]);

  useEffect(() => { load(); }, [load]);

  const handleSend = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      const result = await api.sendAdminPush({
        title: form.title,
        body: form.body,
        url: form.url,
        branch_id: form.branch_id || undefined,
        target: form.target,
      });
      if (result.sent === 0) {
        show('Нет подписчиков для отправки', 'error');
      } else {
        show(`Отправлено: ${result.sent} из ${result.total}`);
        setForm((prev) => ({ ...prev, title: '', body: '' }));
      }
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {Toast}

      <div className="card admin-push-card">
        <div className="card-header admin-push-card-header">
          <div>
            <h2>Push-уведомления снабженцам</h2>
            <p className="admin-push-lead">
              Сообщение придёт как системное уведомление в PWA или Android-приложении «Снабжение».
            </p>
          </div>
        </div>

        <div className="card-body">
          {!pushReady && (
            <div className="admin-push-alert" role="alert">
              Push-уведомления не настроены на сервере. Задайте <code>VAPID_PUBLIC_KEY</code> и{' '}
              <code>VAPID_PRIVATE_KEY</code> в Railway и перезапустите сервис.
            </div>
          )}

          <form className="admin-push-form" onSubmit={handleSend}>
            <label className="filter-field admin-push-field-full">
              Заголовок
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Например: Срочная заявка"
                maxLength={120}
                required
                disabled={!pushReady}
              />
            </label>

            <label className="filter-field admin-push-field-full">
              Текст уведомления
              <textarea
                value={form.body}
                onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
                placeholder="Текст, который увидит снабженец"
                rows={4}
                maxLength={500}
                required
                disabled={!pushReady}
              />
            </label>

            <div className="admin-push-options">
              <label className="filter-field">
                Ссылка при нажатии
                <input
                  type="text"
                  value={form.url}
                  onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                  placeholder="/snab"
                  disabled={!pushReady}
                />
              </label>

              <label className="filter-field">
                Филиал
                <select
                  value={form.branch_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, branch_id: e.target.value }))}
                  disabled={!pushReady}
                >
                  <option value="">Все снабженцы</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>

              <label className="filter-field">
                Аудитория
                <select
                  value={form.target}
                  onChange={(e) => setForm((prev) => ({ ...prev, target: e.target.value }))}
                  disabled={!pushReady}
                >
                  <option value="snab">Снабженцы</option>
                  <option value="all">Все подписчики</option>
                </select>
              </label>
            </div>

            <div className="admin-push-actions">
              <button type="submit" className="btn btn-primary" disabled={sending || !pushReady}>
                {sending ? 'Отправка…' : 'Отправить уведомление'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="card admin-push-card">
        <div className="card-header admin-push-card-header">
          <h3>Подписчики</h3>
          <span className="admin-push-subscribers-meta">
            {loading ? 'Загрузка…' : `${subscribers.total} пользователей · ${subscribers.subscriptions} устройств`}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table security-table">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Имя</th>
                <th>Филиал</th>
                <th>Устройств</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="empty">Загрузка...</td></tr>}
              {!loading && subscribers.items.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.username}</td>
                  <td>{row.name || '—'}</td>
                  <td>{row.branch_name || '—'}</td>
                  <td>{row.devices}</td>
                </tr>
              ))}
              {!loading && subscribers.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty">
                    Подписчиков пока нет — снабженцы должны включить уведомления в приложении на странице /snab
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
