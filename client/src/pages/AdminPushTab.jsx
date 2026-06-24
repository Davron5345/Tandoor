import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Modal';

const RECIPIENT_MODES = [
  { value: 'snab', label: 'Всем снабженцам с уведомлениями' },
  { value: 'all', label: 'Всем подписчикам (любая роль)' },
  { value: 'branch', label: 'По филиалу' },
  { value: 'selected', label: 'Выбранным вручную' },
];

function countRecipientDevices(mode, items, branchId, selectedUserIds) {
  const subscribed = items.filter((row) => row.subscribed);
  if (mode === 'selected') {
    return items
      .filter((row) => selectedUserIds.has(row.user_id) && row.subscribed)
      .reduce((sum, row) => sum + row.devices, 0);
  }
  if (mode === 'branch' && branchId) {
    return subscribed
      .filter((row) => !row.branch_id || row.branch_id === branchId)
      .reduce((sum, row) => sum + row.devices, 0);
  }
  return subscribed.reduce((sum, row) => sum + row.devices, 0);
}

export default function AdminPushTab() {
  const [branches, setBranches] = useState([]);
  const [recipients, setRecipients] = useState({
    items: [], total: 0, subscribed_users: 0, subscriptions: 0,
  });
  const [listFilter, setListFilter] = useState({
    branch_id: '',
    audience: 'snab',
    visibility: 'all',
  });
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

      const [branchList, data] = await Promise.all([
        api.getBranches(),
        api.getAdminPushSubscribers(params),
      ]);
      setBranches(branchList);
      setRecipients(data);
      setPushReady(true);
      setSelectedUserIds((prev) => {
        const valid = new Set(data.items.map((row) => row.user_id));
        return new Set([...prev].filter((id) => valid.has(id)));
      });
    } catch (e) {
      if (String(e.message || '').includes('не настроены')) {
        setPushReady(false);
        setRecipients({ items: [], total: 0, subscribed_users: 0, subscriptions: 0 });
      } else {
        show(e.message, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [listFilter.audience, listFilter.branch_id, show]);

  useEffect(() => { load(); }, [load]);

  const visibleItems = useMemo(() => {
    const items = recipients.items || [];
    if (listFilter.visibility === 'subscribed') {
      return items.filter((row) => row.subscribed);
    }
    if (listFilter.visibility === 'unsubscribed') {
      return items.filter((row) => !row.subscribed);
    }
    return items;
  }, [recipients.items, listFilter.visibility]);

  const selectableItems = visibleItems.filter((row) => row.subscribed);
  const allVisibleSelected = selectableItems.length > 0
    && selectableItems.every((row) => selectedUserIds.has(row.user_id));

  const recipientDevices = useMemo(
    () => countRecipientDevices(
      form.recipient_mode,
      recipients.items || [],
      form.branch_id,
      selectedUserIds,
    ),
    [form.recipient_mode, form.branch_id, recipients.items, selectedUserIds],
  );

  const toggleUser = (userId, subscribed) => {
    if (!subscribed) return;
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
        selectableItems.forEach((row) => next.delete(row.user_id));
        return next;
      });
      return;
    }
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      selectableItems.forEach((row) => next.add(row.user_id));
      return next;
    });
  };

  const handleSend = async (event) => {
    event.preventDefault();

    if (form.recipient_mode === 'selected' && selectedUserIds.size === 0) {
      show('Отметьте подписанных получателей в таблице ниже', 'error');
      return;
    }
    if (form.recipient_mode === 'branch' && !form.branch_id) {
      show('Выберите филиал для рассылки', 'error');
      return;
    }
    if (recipientDevices === 0) {
      const unsubscribed = (recipients.items || []).filter((row) => !row.subscribed);
      if (unsubscribed.length > 0) {
        const names = unsubscribed.slice(0, 3).map((row) => row.username).join(', ');
        show(`Нет подписчиков. Попросите включить уведомления на /snab: ${names}${unsubscribed.length > 3 ? '…' : ''}`, 'error');
      } else {
        show('Нет снабженцев с правом заявок — проверьте роли пользователей', 'error');
      }
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

  const unsubscribedCount = (recipients.items || []).filter((row) => !row.subscribed).length;

  return (
    <>
      {Toast}

      <div className="card admin-push-card">
        <div className="card-header admin-push-card-header">
          <div>
            <h2>Push-уведомления снабженцам</h2>
            <p className="admin-push-lead">
              Push приходит только после включения уведомлений на странице /snab на телефоне снабженца.
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

          {pushReady && unsubscribedCount > 0 && (
            <div className="admin-push-alert admin-push-alert-warn" role="status">
              {unsubscribedCount} снабженец(ов) ещё не включили push — они видны в таблице со статусом «Не подписан».
              Попросите открыть /snab и нажать «Уведомления».
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
                <span> · выбрано: {selectedUserIds.size}</span>
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
            <h3>Снабженцы и подписки</h3>
            <span className="admin-push-subscribers-meta">
              {loading
                ? 'Загрузка…'
                : `${recipients.subscribed_users || 0} с push из ${recipients.total || 0} · ${recipients.subscriptions || 0} устройств`}
            </span>
          </div>
          {form.recipient_mode === 'selected' && selectableItems.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAllVisible}>
              {allVisibleSelected ? 'Снять выделение' : 'Выбрать подписанных'}
            </button>
          )}
        </div>

        <div className="card-body admin-push-list-filters">
          <div className="admin-push-options">
            <label className="filter-field">
              Филиал
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
              Категория
              <select
                value={listFilter.audience}
                onChange={(e) => setListFilter((prev) => ({ ...prev, audience: e.target.value }))}
              >
                <option value="snab">Снабженцы</option>
                <option value="all">Все пользователи</option>
              </select>
            </label>
            <label className="filter-field">
              Статус push
              <select
                value={listFilter.visibility}
                onChange={(e) => setListFilter((prev) => ({ ...prev, visibility: e.target.value }))}
              >
                <option value="all">Все</option>
                <option value="subscribed">Только подписанные</option>
                <option value="unsubscribed">Без push</option>
              </select>
            </label>
          </div>
          {form.recipient_mode === 'selected' && (
            <p className="admin-push-hint">
              Галочки доступны только у подписанных — остальным нужно включить уведомления на /snab.
            </p>
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
                <th>Статус</th>
                <th>Устройств</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={form.recipient_mode === 'selected' ? 6 : 5} className="empty">Загрузка...</td>
                </tr>
              )}
              {!loading && visibleItems.map((row) => {
                const checked = selectedUserIds.has(row.user_id);
                return (
                  <tr
                    key={row.user_id}
                    className={`${checked ? 'row-selected' : ''}${!row.subscribed ? ' admin-push-row-muted' : ''}`}
                  >
                    {form.recipient_mode === 'selected' && (
                      <td className="admin-push-col-check">
                        <label className={`admin-push-check${!row.subscribed ? ' admin-push-check-disabled' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!row.subscribed}
                            onChange={() => toggleUser(row.user_id, row.subscribed)}
                            aria-label={`Выбрать ${row.username}`}
                          />
                        </label>
                      </td>
                    )}
                    <td>{row.username}</td>
                    <td>{row.name || '—'}</td>
                    <td>{row.branch_name || '—'}</td>
                    <td>
                      <span className={`badge ${row.subscribed ? 'badge-success' : 'badge-warning'}`}>
                        {row.subscribed ? 'Подписан' : 'Не подписан'}
                      </span>
                    </td>
                    <td>{row.devices || '—'}</td>
                  </tr>
                );
              })}
              {!loading && visibleItems.length === 0 && (
                <tr>
                  <td colSpan={form.recipient_mode === 'selected' ? 6 : 5} className="empty">
                    Нет пользователей по выбранному фильтру
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
