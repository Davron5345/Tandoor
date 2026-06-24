import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Modal';

const RECIPIENT_MODES = [
  { value: 'snab', label: 'Всем снабженцам с уведомлениями' },
  { value: 'all', label: 'Всем подписчикам (любая роль)' },
  { value: 'branch', label: 'По филиалу' },
  { value: 'selected', label: 'Выбранным вручную' },
];

function countRecipients(mode, subscribers, branchId, selectedUserIds) {
  const items = subscribers.items || [];
  if (mode === 'selected') {
    return items
      .filter((row) => selectedUserIds.has(row.user_id))
      .reduce((sum, row) => sum + row.devices, 0);
  }
  if (mode === 'branch' && branchId) {
    return items
      .filter((row) => !row.branch_id || row.branch_id === branchId)
      .reduce((sum, row) => sum + row.devices, 0);
  }
  return subscribers.subscriptions || 0;
}

export default function AdminPushTab() {
  const [branches, setBranches] = useState([]);
  const [subscribers, setSubscribers] = useState({ items: [], total: 0, subscriptions: 0 });
  const [listFilter, setListFilter] = useState({ branch_id: '', audience: 'all' });
  const [loading, setLoading] = useState(true);
  const [pushReady, setPushReady] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState(() => new Set());
  const [form, setForm] = useState({
    title: '',
    body: '',
    url: '/snab',
    branch_id: '',
    recipient_mode: 'snab',
  });
  const { show, Toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { audience: listFilter.audience };
      if (listFilter.branch_id) params.branch_id = listFilter.branch_id;

      const [branchList, subs] = await Promise.all([
        api.getBranches(),
        api.getAdminPushSubscribers(params),
      ]);
      setBranches(branchList);
      setSubscribers(subs);
      setPushReady(true);
      setSelectedUserIds((prev) => {
        const valid = new Set(subs.items.map((row) => row.user_id));
        return new Set([...prev].filter((id) => valid.has(id)));
      });
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
  }, [listFilter, show]);

  useEffect(() => { load(); }, [load]);

  const visibleItems = subscribers.items || [];
  const allVisibleSelected = visibleItems.length > 0
    && visibleItems.every((row) => selectedUserIds.has(row.user_id));
  const recipientDevices = useMemo(
    () => countRecipients(form.recipient_mode, subscribers, form.branch_id, selectedUserIds),
    [form.recipient_mode, form.branch_id, subscribers, selectedUserIds],
  );

  const toggleUser = (userId) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedUserIds((prev) => {
        const next = new Set(prev);
        visibleItems.forEach((row) => next.delete(row.user_id));
        return next;
      });
      return;
    }
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      visibleItems.forEach((row) => next.add(row.user_id));
      return next;
    });
  };

  const handleSend = async (event) => {
    event.preventDefault();

    if (form.recipient_mode === 'selected' && selectedUserIds.size === 0) {
      show('Отметьте получателей в таблице ниже', 'error');
      return;
    }
    if (form.recipient_mode === 'branch' && !form.branch_id) {
      show('Выберите филиал для рассылки', 'error');
      return;
    }
    if (recipientDevices === 0) {
      show('Нет подписчиков — снабженцы должны включить уведомления на /snab', 'error');
      return;
    }

    setSending(true);
    try {
      const payload = {
        title: form.title,
        body: form.body,
        url: form.url,
        target: form.recipient_mode === 'selected' ? 'selected' : form.recipient_mode,
      };
      if (form.recipient_mode === 'branch') {
        payload.branch_id = form.branch_id;
        payload.target = 'snab';
      }
      if (form.recipient_mode === 'selected') {
        payload.user_ids = [...selectedUserIds];
        payload.target = 'selected';
      }

      const result = await api.sendAdminPush(payload);
      if (result.sent === 0) {
        show('Не удалось доставить ни одному устройству — проверьте подписки', 'error');
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
              Push доставляется только тем, кто включил уведомления в приложении на странице /snab.
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

            <div className="admin-push-options admin-push-options-recipient">
              <label className="filter-field">
                Кому отправить
                <select
                  value={form.recipient_mode}
                  onChange={(e) => setForm((prev) => ({ ...prev, recipient_mode: e.target.value }))}
                  disabled={!pushReady}
                >
                  {RECIPIENT_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                  ))}
                </select>
              </label>

              {form.recipient_mode === 'branch' && (
                <label className="filter-field">
                  Филиал получателей
                  <select
                    value={form.branch_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, branch_id: e.target.value }))}
                    disabled={!pushReady}
                    required
                  >
                    <option value="">Выберите филиал</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name}</option>
                    ))}
                  </select>
                </label>
              )}

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
            </div>

            <div className="admin-push-send-summary">
              Будет отправлено на <strong>{recipientDevices}</strong> устройств
              {form.recipient_mode === 'selected' && (
                <span> · выбрано пользователей: {selectedUserIds.size}</span>
              )}
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
          <div>
            <h3>Подписчики</h3>
            <span className="admin-push-subscribers-meta">
              {loading ? 'Загрузка…' : `${subscribers.total} пользователей · ${subscribers.subscriptions} устройств`}
            </span>
          </div>
          {form.recipient_mode === 'selected' && visibleItems.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAllVisible}>
              {allVisibleSelected ? 'Снять выделение' : 'Выбрать всех в списке'}
            </button>
          )}
        </div>

        <div className="card-body admin-push-list-filters">
          <div className="admin-push-options">
            <label className="filter-field">
              Фильтр списка: филиал
              <select
                value={listFilter.branch_id}
                onChange={(e) => setListFilter((prev) => ({ ...prev, branch_id: e.target.value }))}
              >
                <option value="">Все филиалы</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </label>
            <label className="filter-field">
              Показать
              <select
                value={listFilter.audience}
                onChange={(e) => setListFilter((prev) => ({ ...prev, audience: e.target.value }))}
              >
                <option value="all">Всех подписчиков</option>
                <option value="snab">Только снабженцев</option>
              </select>
            </label>
          </div>
          {form.recipient_mode === 'selected' && (
            <p className="admin-push-hint">Отметьте галочками, кому отправить сообщение.</p>
          )}
        </div>

        <div className="table-wrap">
          <table className="data-table security-table admin-push-table">
            <thead>
              <tr>
                {form.recipient_mode === 'selected' && <th className="admin-push-col-check" aria-label="Выбор" />}
                <th>Пользователь</th>
                <th>Имя</th>
                <th>Филиал</th>
                <th>Устройств</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={form.recipient_mode === 'selected' ? 5 : 4} className="empty">Загрузка...</td></tr>}
              {!loading && visibleItems.map((row) => {
                const checked = selectedUserIds.has(row.user_id);
                return (
                  <tr key={row.user_id} className={checked ? 'row-selected' : ''}>
                    {form.recipient_mode === 'selected' && (
                      <td className="admin-push-col-check">
                        <label className="admin-push-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleUser(row.user_id)}
                            aria-label={`Выбрать ${row.username}`}
                          />
                        </label>
                      </td>
                    )}
                    <td>{row.username}</td>
                    <td>{row.name || '—'}</td>
                    <td>{row.branch_name || '—'}</td>
                    <td>{row.devices}</td>
                  </tr>
                );
              })}
              {!loading && visibleItems.length === 0 && (
                <tr>
                  <td colSpan={form.recipient_mode === 'selected' ? 5 : 4} className="empty">
                    Подписчиков пока нет — откройте /snab на телефоне снабженца и нажмите «Уведомления»
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
