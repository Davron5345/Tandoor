import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Modal';

export default function AdminPushTab() {
  const [branches, setBranches] = useState([]);
  const [subscribers, setSubscribers] = useState({ items: [], total: 0, subscriptions: 0 });
  const [loading, setLoading] = useState(true);
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
    } catch (e) {
      show(e.message, 'error');
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
      <div className="card security-card">
        <div className="card-header">
          <h2>Push-уведомления снабженцам</h2>
          <p className="text-muted">
            Сообщение придёт как системное уведомление в PWA или Android-приложении «Снабжение».
          </p>
        </div>

        <form className="admin-push-form" onSubmit={handleSend}>
          <div className="form-row">
            <label>
              <span>Заголовок</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Например: Срочная заявка"
                maxLength={120}
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              <span>Текст</span>
              <textarea
                value={form.body}
                onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
                placeholder="Текст уведомления"
                rows={3}
                maxLength={500}
                required
              />
            </label>
          </div>
          <div className="form-row admin-push-form-grid">
            <label>
              <span>Ссылка при нажатии</span>
              <input
                type="text"
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="/snab"
              />
            </label>
            <label>
              <span>Филиал</span>
              <select
                value={form.branch_id}
                onChange={(e) => setForm((prev) => ({ ...prev, branch_id: e.target.value }))}
              >
                <option value="">Все снабженцы</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Аудитория</span>
              <select
                value={form.target}
                onChange={(e) => setForm((prev) => ({ ...prev, target: e.target.value }))}
              >
                <option value="snab">Снабженцы (shop_orders.view)</option>
                <option value="all">Все подписчики</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={sending}>
              {sending ? 'Отправка…' : 'Отправить уведомление'}
            </button>
          </div>
        </form>
      </div>

      <div className="card security-card">
        <div className="card-header">
          <h3>Подписчики</h3>
          <span className="text-muted">
            {loading ? 'Загрузка…' : `${subscribers.total} пользователей · ${subscribers.subscriptions} устройств`}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
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
                <tr><td colSpan={4} className="empty">Подписчиков пока нет — снабженцы должны включить уведомления в приложении</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
