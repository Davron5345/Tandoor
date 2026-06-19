import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api';
import Modal, { useToast } from '../components/Modal';
import { useAuth } from '../AuthContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { hasPermission } from '../permissions';

export default function TelegramPage({ onStatusChange }) {
  const { user } = useAuth();
  const canManageSettings = hasPermission(user, 'telegram.settings');
  const canSend = hasPermission(user, 'telegram.send');
  const [settings, setSettings] = useState(null);
  const [messages, setMessages] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ counterparty_id: '', message: '' });
  const [tokenInput, setTokenInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const { show, Toast } = useToast();

  const load = useCallback(() => {
    const requests = [
      api.getTelegramStatus(),
      api.getTelegramMessages(),
      api.getCounterparties(),
    ];
    if (canManageSettings) {
      requests[0] = api.getTelegramSettings();
    }

    Promise.all(requests).then((results) => {
      if (canManageSettings) {
        const [s, m, c] = results;
        setSettings(s);
        setMessages(m);
        setCounterparties(c.filter((x) => x.telegram_chat_id));
      } else {
        const [status, m, c] = results;
        setSettings({ enabled: status.enabled, hasToken: status.enabled });
        setMessages(m);
        setCounterparties(c.filter((x) => x.telegram_chat_id));
      }
    }).catch(console.error);
  }, [canManageSettings]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, [load], { enabled: !modal });

  const startEdit = () => {
    setEditing(true);
    setTokenInput('');
    setShowToken(false);
  };

  const cancelEdit = () => {
    setEditing(false);
    setTokenInput('');
    setShowToken(false);
  };

  const saveToken = async () => {
    if (!tokenInput.trim()) {
      show('Введите токен бота', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await api.saveTelegramToken(tokenInput.trim());
      setSettings(result);
      setEditing(false);
      setTokenInput('');
      show('Токен сохранён, бот перезапущен');
      onStatusChange?.();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeToken = async () => {
    if (!confirm('Удалить токен бота? Telegram-уведомления перестанут работать.')) return;
    try {
      const result = await api.removeTelegramToken();
      setSettings(result);
      setEditing(false);
      setTokenInput('');
      show('Токен удалён');
      onStatusChange?.();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const send = async () => {
    try {
      await api.sendTelegramMessage(form);
      show('Сообщение отправлено');
      setModal(false);
      setForm({ counterparty_id: '', message: '' });
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Telegram</h1>
        {canSend && (
          <button className="btn btn-primary" onClick={() => setModal(true)} disabled={!settings?.enabled}>
            📨 Отправить сообщение
          </button>
        )}
      </div>

      {canManageSettings && (
      <div className="card">
        <div className="card-header">
          <strong>🔑 Токен бота</strong>
          {settings?.enabled && <span className="badge badge-confirmed">Активен</span>}
        </div>
        <div className="card-body">
          <div className={`alert ${settings?.enabled ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
            {settings?.enabled
              ? '✅ Бот работает. Уведомления отправляются автоматически при проведении документов.'
              : '⚠️ Бот не настроен. Получите токен у @BotFather и вставьте ниже.'}
          </div>

          {settings?.hasToken && !editing && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>Текущий токен</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={settings.tokenMasked} disabled style={{ flex: 1, fontFamily: 'monospace' }} />
                {settings.updatedAt && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    обновлён {formatDate(settings.updatedAt)}
                  </span>
                )}
              </div>
            </div>
          )}

          {(editing || !settings?.hasToken) && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>{settings?.hasToken ? 'Новый токен бота' : 'Токен бота от @BotFather'}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={showToken ? 'text' : 'password'}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  style={{ flex: 1, fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowToken(!showToken)}
                  title={showToken ? 'Скрыть' : 'Показать'}
                >
                  {showToken ? '🙈' : '👁️'}
                </button>
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Формат: число:строка (например, 7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw)
              </span>
            </div>
          )}

          <div className="btn-group">
            {!editing && settings?.hasToken && (
              <>
                <button className="btn btn-primary" onClick={startEdit}>✏️ Изменить токен</button>
                <button className="btn btn-ghost" onClick={removeToken}>🗑️ Удалить</button>
              </>
            )}
            {(editing || !settings?.hasToken) && (
              <>
                <button className="btn btn-primary" onClick={saveToken} disabled={saving}>
                  {saving ? 'Сохранение...' : '💾 Сохранить'}
                </button>
                {settings?.hasToken && (
                  <button className="btn btn-ghost" onClick={cancelEdit}>Отмена</button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      )}

      <div className="card">
        <div className="card-header"><strong>Как подключить контрагента</strong></div>
        <div className="card-body" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
            <li>Создайте бота через <strong>@BotFather</strong> в Telegram</li>
            {canManageSettings ? (
              <li>Скопируйте токен и вставьте в поле выше</li>
            ) : (
              <li>Администратор настраивает токен бота в этом разделе</li>
            )}
            <li>Контрагент пишет боту команду <strong>/start</strong></li>
            <li>Бот пришлёт Chat ID — укажите его в карточке контрагента</li>
            <li>При проведении документа уведомление отправится автоматически</li>
          </ol>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><strong>История сообщений</strong></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Контрагент</th>
                <th>Документ</th>
                <th>Статус</th>
                <th>Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.created_at)}</td>
                  <td>{m.counterparty_name || '—'}</td>
                  <td>{m.document_number || '—'}</td>
                  <td>
                    <span className={`badge badge-${m.status === 'sent' ? 'confirmed' : 'cancelled'}`}>
                      {m.status === 'sent' ? 'Отправлено' : 'Ошибка'}
                    </span>
                  </td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.message}
                  </td>
                </tr>
              ))}
              {messages.length === 0 && (
                <tr><td colSpan={5} className="empty">Сообщений пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && canSend && (
        <Modal
          title="Отправить сообщение"
          onClose={() => setModal(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={send}>Отправить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group full">
              <label>Контрагент</label>
              <select
                value={form.counterparty_id}
                onChange={(e) => setForm({ ...form, counterparty_id: e.target.value })}
              >
                <option value="">Выберите...</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === 'supplier' ? 'Поставщик' : 'Клиент'})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group full">
              <label>Текст сообщения</label>
              <textarea
                rows={5}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Введите текст для отправки в Telegram..."
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
