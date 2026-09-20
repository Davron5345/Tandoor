import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatMoney, formatPriceInput, parsePriceInput } from '../api';
import Modal, { useToast } from './Modal';
import { todayLocalIso } from '../utils/date';

export default function CashierSalaryModal({
  open,
  onClose,
  shiftDate,
  canPay = false,
  isAdmin = false,
  branchName = '',
  onPaid,
}) {
  const { show, Toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ departments: [], total_debt: 0, items: [] });
  const [recent, setRecent] = useState([]);
  const [query, setQuery] = useState('');
  const [presentOnly, setPresentOnly] = useState(false);
  const [payEmp, setPayEmp] = useState(null);
  const [accrue, setAccrue] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [settingsForm, setSettingsForm] = useState({
    enabled: false,
    base_url: 'https://faceid.up.railway.app',
    device_key: '',
    webhook_secret: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, att] = await Promise.all([
        api.getPayrollEmployees(presentOnly ? { present: '1' } : {}),
        api.getPayrollRecentAttendance({ limit: 12 }),
      ]);
      setData(list || { departments: [], total_debt: 0, items: [] });
      setRecent(Array.isArray(att) ? att : []);
    } catch (err) {
      show(err.message || 'Не удалось загрузить зарплату', 'error');
      setData({ departments: [], total_debt: 0, items: [] });
    } finally {
      setLoading(false);
    }
  }, [presentOnly, show]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const filteredDepartments = useMemo(() => {
    const q = query.trim().toLowerCase();
    const deps = data.departments || [];
    if (!q) return deps;
    return deps
      .map((d) => ({
        ...d,
        employees: (d.employees || []).filter((e) => (
          (e.full_name || '').toLowerCase().includes(q)
          || (e.position || '').toLowerCase().includes(q)
          || (e.tab_no || '').toLowerCase().includes(q)
          || (e.department || '').toLowerCase().includes(q)
        )),
      }))
      .filter((d) => d.employees.length > 0);
  }, [data.departments, query]);

  const numberedRows = useMemo(() => {
    let n = 0;
    return filteredDepartments.map((dep) => ({
      ...dep,
      employees: (dep.employees || []).map((emp) => {
        n += 1;
        return { ...emp, _num: n };
      }),
    }));
  }, [filteredDepartments]);

  const openPay = (emp) => {
    setPayEmp(emp);
    setAccrue(emp.base_salary > 0 ? formatPriceInput(String(emp.base_salary)) : '');
    setPayAmount(emp.balance > 0 ? formatPriceInput(String(emp.balance)) : '');
    setComment('');
  };

  const submitPay = async () => {
    if (!payEmp) return;
    const pay = parsePriceInput(payAmount);
    const acc = parsePriceInput(accrue) || 0;
    if (!pay || pay <= 0) {
      show('Укажите сумму выплаты', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await api.payPayrollEmployee(payEmp.id, {
        pay_amount: pay,
        accrue_amount: acc,
        date: shiftDate || todayLocalIso(),
        comment,
      });
      show(
        `Выплачено ${formatMoney(result.paid)}. Долг: ${formatMoney(result.balance)}`,
        'success',
      );
      setPayEmp(null);
      await load();
      onPaid?.();
    } catch (err) {
      show(err.message || 'Ошибка выплаты', 'error');
    } finally {
      setSaving(false);
    }
  };

  const syncEmployees = async () => {
    try {
      const res = await api.syncFaceIdEmployees();
      show(`Синхронизировано сотрудников: ${res.upserted}`, 'success');
      await load();
    } catch (err) {
      show(err.message || 'Ошибка синхронизации', 'error');
    }
  };

  const syncAttendance = async () => {
    try {
      const res = await api.syncFaceIdAttendance({
        from: shiftDate || todayLocalIso(),
        to: shiftDate || todayLocalIso(),
      });
      show(`Отметок: +${res.imported}`, 'success');
      await load();
    } catch (err) {
      show(err.message || 'Ошибка загрузки отметок', 'error');
    }
  };

  const openSettings = async () => {
    try {
      const cfg = await api.getFaceIdSettings();
      setSettings(cfg);
      setSettingsForm({
        enabled: !!cfg.enabled,
        base_url: cfg.base_url || 'https://faceid.up.railway.app',
        device_key: '',
        webhook_secret: '',
      });
      setSettingsOpen(true);
    } catch (err) {
      show(err.message || 'Нет доступа к настройкам', 'error');
    }
  };

  const saveSettings = async () => {
    try {
      const body = {
        enabled: settingsForm.enabled,
        base_url: settingsForm.base_url,
      };
      if (settingsForm.device_key.trim()) body.device_key = settingsForm.device_key.trim();
      if (settingsForm.webhook_secret.trim()) body.webhook_secret = settingsForm.webhook_secret.trim();
      const cfg = await api.saveFaceIdSettings(body);
      setSettings(cfg);
      show('Настройки Face ID сохранены', 'success');
      setSettingsOpen(false);
    } catch (err) {
      show(err.message || 'Не удалось сохранить', 'error');
    }
  };

  if (!open) return null;

  const debtAfter = (() => {
    const pay = parsePriceInput(payAmount) || 0;
    const acc = parsePriceInput(accrue) || 0;
    const base = Number(payEmp?.balance) || 0;
    return Math.max(0, Math.round((base + acc - pay) * 100) / 100);
  })();

  return (
    <>
      {Toast}
      <Modal
        title={branchName ? `Зарплата · ${branchName}` : 'Зарплата'}
        onClose={onClose}
        wide
        className="modal-payroll"
        footer={(
          <div className="payroll-modal-footer">
            {isAdmin && (
              <button type="button" className="btn btn-ghost" onClick={openSettings}>
                Face ID
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={syncEmployees}>
              Синхр. сотрудников
            </button>
            <button type="button" className="btn btn-ghost" onClick={syncAttendance}>
              Синхр. отметок
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Закрыть
            </button>
          </div>
        )}
      >
        <div className="payroll-toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск сотрудника…"
            aria-label="Поиск"
          />
          <label className="payroll-present-toggle">
            <input
              type="checkbox"
              checked={presentOnly}
              onChange={(e) => setPresentOnly(e.target.checked)}
            />
            Только на смене
          </label>
          {branchName && (
            <span className="payroll-branch-chip" title="Филиал">{branchName}</span>
          )}
          <span className="payroll-debt-total">
            Долг всего: <strong>{formatMoney(data.total_debt || 0)}</strong>
          </span>
        </div>

        {recent.length > 0 && (
          <div className="payroll-recent">
            <div className="payroll-recent-title">Последние отметки Face ID</div>
            <ul>
              {recent.slice(0, 8).map((ev) => (
                <li key={ev.id}>
                  <span className={`payroll-badge ${ev.event_type === 'in' ? 'is-in' : 'is-out'}`}>
                    {ev.event_type === 'in' ? 'Пришёл' : 'Ушёл'}
                  </span>
                  <strong>{ev.full_name}</strong>
                  <span className="payroll-muted">{ev.department || ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <p className="payroll-empty">Загрузка…</p>
        ) : numberedRows.length === 0 ? (
          <p className="payroll-empty">
            Нет сотрудников. Нажмите «Синхр. сотрудников» после настройки Face ID.
          </p>
        ) : (
          <div className="payroll-departments">
            {numberedRows.map((dep) => (
              <section key={dep.name} className="payroll-dept">
                <header className="payroll-dept-head">
                  <h3>{dep.name}</h3>
                  <span>долг {formatMoney(dep.debt_sum || 0)}</span>
                </header>
                <ul className="payroll-emp-list">
                  {dep.employees.map((emp) => (
                    <li key={emp.id} className="payroll-emp-row">
                      <span className="payroll-emp-num" aria-hidden>{emp._num}</span>
                      <div className="payroll-emp-main">
                        <strong>{emp.full_name}</strong>
                        <span className="payroll-muted">
                          {[
                            branchName,
                            emp.position,
                            emp.tab_no ? `№${emp.tab_no}` : '',
                          ].filter(Boolean).join(' · ')}
                        </span>
                        <span className={`payroll-badge ${emp.present ? 'is-in' : 'is-out'}`}>
                          {emp.present ? 'На смене' : (emp.last_event_type === 'out' ? 'Ушёл' : '—')}
                        </span>
                      </div>
                      <div className="payroll-emp-debt">
                        <span className="label">Долг</span>
                        <strong>{formatMoney(emp.balance)}</strong>
                      </div>
                      {canPay && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => openPay(emp)}
                        >
                          Выплатить
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Modal>

      {payEmp && (
        <Modal
          title={`Выплата — ${payEmp.full_name}`}
          onClose={() => setPayEmp(null)}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setPayEmp(null)} disabled={saving}>
                Отмена
              </button>
              <button type="button" className="btn btn-primary" onClick={submitPay} disabled={saving}>
                {saving ? 'Сохранение…' : 'Выплатить'}
              </button>
            </>
          )}
        >
          <p className="payroll-pay-hint">
            Текущий долг: <strong>{formatMoney(payEmp.balance)}</strong>.
            Начислите зарплату и укажите, сколько выдать сейчас — остаток останется долгом.
          </p>
          <div className="form-grid">
            <label className="form-group">
              <span>Начислить</span>
              <input
                inputMode="decimal"
                value={accrue}
                onChange={(e) => setAccrue(formatPriceInput(e.target.value))}
                placeholder="0"
              />
            </label>
            <label className="form-group">
              <span>Выплатить *</span>
              <input
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(formatPriceInput(e.target.value))}
                placeholder="0"
              />
            </label>
            <label className="form-group form-group-span-2">
              <span>Комментарий</span>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="За смену / аванс…" />
            </label>
          </div>
          <p className="payroll-pay-result">
            После выплаты долг будет: <strong>{formatMoney(debtAfter)}</strong>
          </p>
        </Modal>
      )}

      {settingsOpen && (
        <Modal
          title="Настройки Face ID"
          onClose={() => setSettingsOpen(false)}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setSettingsOpen(false)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={saveSettings}>Сохранить</button>
            </>
          )}
        >
          <label className="form-group">
            <span>
              <input
                type="checkbox"
                checked={settingsForm.enabled}
                onChange={(e) => setSettingsForm((p) => ({ ...p, enabled: e.target.checked }))}
              />
              {' '}Включить интеграцию
            </span>
          </label>
          <label className="form-group">
            <span>URL Face ID</span>
            <input
              value={settingsForm.base_url}
              onChange={(e) => setSettingsForm((p) => ({ ...p, base_url: e.target.value }))}
            />
          </label>
          <label className="form-group">
            <span>X-Device-Key {settings?.device_key_set ? '(задан, введите новый чтобы заменить)' : ''}</span>
            <input
              type="password"
              autoComplete="off"
              value={settingsForm.device_key}
              onChange={(e) => setSettingsForm((p) => ({ ...p, device_key: e.target.value }))}
              placeholder={settings?.device_key_set ? '••••••••' : 'Ключ из Face ID'}
            />
          </label>
          <label className="form-group">
            <span>Webhook secret (опционально)</span>
            <input
              type="password"
              autoComplete="off"
              value={settingsForm.webhook_secret}
              onChange={(e) => setSettingsForm((p) => ({ ...p, webhook_secret: e.target.value }))}
              placeholder={settings?.webhook_secret_set ? '••••••••' : ''}
            />
          </label>
          {settings?.webhook_url && (
            <p className="payroll-webhook-url">
              URL для входящих отметок:<br />
              <code>{settings.webhook_url}</code>
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
