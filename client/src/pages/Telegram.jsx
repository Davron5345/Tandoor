import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api';
import Modal, { useToast } from '../components/Modal';
import { IconEdit, IconEye, IconEyeOff, IconKey, IconSave, IconSend, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { hasPermission } from '../permissions';

export default function TelegramPage({ onStatusChange }) {
  const { user } = useAuth();
  const canManageSettings = hasPermission(user, 'telegram.settings');
  const canSend = hasPermission(user, 'telegram.send');
  const [tab, setTab] = useState('bot');
  const [settings, setSettings] = useState(null);
  const [messages, setMessages] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ counterparty_id: '', message: '' });
  const [tokenInput, setTokenInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  const [aiKeyInput, setAiKeyInput] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiRefreshing, setAiRefreshing] = useState(false);
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

    if (canManageSettings) {
      api.getAiSettings()
        .then((ai) => {
          setAiSettings(ai);
          setAiModel(ai.model || '');
        })
        .catch(console.error);
    }
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

  const saveAi = async () => {
    setAiSaving(true);
    try {
      const body = { model: aiModel };
      if (aiKeyInput.trim()) body.api_key = aiKeyInput.trim();
      const result = await api.saveAiSettings(body);
      setAiSettings(result);
      setAiModel(result.model || '');
      setAiKeyInput('');
      show('Настройки ИИ сохранены');
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setAiSaving(false);
    }
  };

  const clearAiKey = async () => {
    if (!confirm('Удалить API-ключ OpenRouter? Распознавание фото остановится.')) return;
    setAiSaving(true);
    try {
      const result = await api.saveAiSettings({ clear_api_key: true, model: aiModel });
      setAiSettings(result);
      show('API-ключ удалён');
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setAiSaving(false);
    }
  };

  const refreshModels = async () => {
    setAiRefreshing(true);
    try {
      if (aiKeyInput.trim()) {
        await api.saveAiSettings({ api_key: aiKeyInput.trim(), model: aiModel || undefined });
        setAiKeyInput('');
      }
      const result = await api.refreshAiModels();
      setAiSettings(result);
      setAiModel(result.model || '');
      show(`Список моделей обновлён (${result.models?.length || 0})`);
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setAiRefreshing(false);
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

  const models = aiSettings?.models || [];
  const visionHint = models.filter((m) => /image|vision|multimodal/i.test(String(m.modality || '')));

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Telegram</h1>
        {canSend && (
          <button className="btn btn-primary" onClick={() => setModal(true)} disabled={!settings?.enabled}>
            <IconSend />
            <span>Отправить сообщение</span>
          </button>
        )}
      </div>

      {canManageSettings && (
        <div className="section-tabs" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`section-tab${tab === 'bot' ? ' active' : ''}`}
            onClick={() => setTab('bot')}
          >
            Бот
          </button>
          <button
            type="button"
            className={`section-tab${tab === 'ai' ? ' active' : ''}`}
            onClick={() => setTab('ai')}
          >
            Искусственный интеллект
          </button>
          <button
            type="button"
            className={`section-tab${tab === 'history' ? ' active' : ''}`}
            onClick={() => setTab('history')}
          >
            История
          </button>
        </div>
      )}

      {(!canManageSettings || tab === 'bot') && (
        <>
          {canManageSettings && (
          <div className="card">
            <div className="card-header">
              <strong className="card-header-title"><IconKey /> Токен бота</strong>
              {settings?.enabled && <span className="badge badge-confirmed">Активен</span>}
            </div>
            <div className="card-body">
              <div className={`alert ${settings?.enabled ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
                {settings?.enabled
                  ? 'Бот работает. Уведомления и приходы из тем (текст и фото) обрабатываются автоматически.'
                  : 'Бот не настроен. Получите токен у @BotFather и вставьте ниже.'}
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
                      className="btn btn-icon btn-ghost"
                      onClick={() => setShowToken(!showToken)}
                      title={showToken ? 'Скрыть' : 'Показать'}
                    >
                      {showToken ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
              )}

              <div className="btn-group">
                {!editing && settings?.hasToken && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={startEdit}>
                      <IconEdit />
                      <span>Изменить токен</span>
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={removeToken}>
                      <IconTrash />
                      <span>Удалить</span>
                    </button>
                  </>
                )}
                {(editing || !settings?.hasToken) && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={saveToken} disabled={saving}>
                      <IconSave />
                      <span>{saving ? 'Сохранение...' : 'Сохранить'}</span>
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
            <div className="card-header"><strong>Как подключить</strong></div>
            <div className="card-body" style={{ fontSize: 14, color: 'var(--text-muted)' }}>
              <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
                <li>Создайте бота через <strong>@BotFather</strong> и укажите токен выше</li>
                <li>Добавьте бота в группу с темами (админом) и включите тему: Закупки → Из Telegram → Темы</li>
                <li>Текстом: «Жалилдан:» и строки товаров — или <strong>фото тетради</strong> (нужен OpenRouter на вкладке ИИ)</li>
                <li>Приходы с ИИ в списке с жёлтым фоном и счётчиком неподтверждённых позиций</li>
              </ol>
            </div>
          </div>
        </>
      )}

      {canManageSettings && tab === 'ai' && (
        <div className="card">
          <div className="card-header">
            <strong className="card-header-title">OpenRouter — распознавание фото прихода</strong>
            {aiSettings?.ready
              ? <span className="badge badge-confirmed">Готово</span>
              : <span className="badge badge-draft">Не настроено</span>}
          </div>
          <div className="card-body">
            <div className="alert alert-info" style={{ marginBottom: 16 }}>
              Ключ с <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">openrouter.ai/keys</a>.
              Выберите vision-модель (с картинками), затем «Обновить» — подтянутся новые модели без ручного ввода id.
              Фото в теме прихода → черновик с жёлтой пометкой «ИИ».
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>
                API-ключ OpenRouter
                {aiSettings?.has_api_key ? ' (задан — введите новый, чтобы заменить)' : ''}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={showAiKey ? 'text' : 'password'}
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  placeholder={aiSettings?.api_key_masked || 'sk-or-…'}
                  style={{ flex: 1, fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="btn btn-icon btn-ghost"
                  onClick={() => setShowAiKey(!showAiKey)}
                  title={showAiKey ? 'Скрыть' : 'Показать'}
                >
                  {showAiKey ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label>Модель</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  style={{ flex: 1, minWidth: 220 }}
                >
                  {!models.length && (
                    <option value={aiModel || ''}>{aiModel || 'Сначала нажмите «Обновить»'}</option>
                  )}
                  {visionHint.length > 0 && (
                    <optgroup label="С поддержкой изображений">
                      {visionHint.map((m) => (
                        <option key={m.id} value={m.id}>{m.name || m.id}</option>
                      ))}
                    </optgroup>
                  )}
                  {models.length > 0 && (
                    <optgroup label="Все модели">
                      {models.map((m) => (
                        <option key={`all-${m.id}`} value={m.id}>{m.name || m.id}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={refreshModels}
                  disabled={aiRefreshing || (!aiSettings?.has_api_key && !aiKeyInput.trim())}
                  title="Загрузить актуальный список моделей с OpenRouter"
                >
                  {aiRefreshing ? 'Обновление…' : 'Обновить'}
                </button>
              </div>
              {aiSettings?.models_updated_at && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Список обновлён {formatDate(aiSettings.models_updated_at)}
                  {models.length ? ` · ${models.length} моделей` : ''}
                </span>
              )}
            </div>

            <div className="btn-group">
              <button type="button" className="btn btn-primary" onClick={saveAi} disabled={aiSaving}>
                <IconSave />
                <span>{aiSaving ? 'Сохранение…' : 'Сохранить'}</span>
              </button>
              {aiSettings?.has_api_key && (
                <button type="button" className="btn btn-ghost" onClick={clearAiKey} disabled={aiSaving}>
                  <IconTrash />
                  <span>Удалить ключ</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {(!canManageSettings || tab === 'history') && (
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
      )}

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
