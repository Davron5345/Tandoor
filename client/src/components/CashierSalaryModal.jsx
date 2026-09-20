import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatMoney, formatPriceInput, parsePriceInput, formatDate } from '../api';
import Modal, { useToast } from './Modal';
import { todayLocalIso } from '../utils/date';

function formatEventClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '—';
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function attendanceCells(emp) {
  const kirish = formatEventClock(emp.today_in_at || (emp.last_event_type === 'in' ? emp.last_event_at : null));
  const chiqish = formatEventClock(emp.today_out_at || (emp.last_event_type === 'out' && !emp.today_in_at ? emp.last_event_at : null));
  return { kirish, chiqish };
}

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
      const params = { date: shiftDate || todayLocalIso() };
      if (presentOnly) params.present = '1';
      const list = await api.getPayrollEmployees(params);
      setData(list || { departments: [], total_debt: 0, items: [] });
    } catch (err) {
      show(err.message || 'Не удалось загрузить зарплату', 'error');
      setData({ departments: [], total_debt: 0, items: [] });
    } finally {
      setLoading(false);
    }
  }, [presentOnly, shiftDate, show]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const sheetDepartments = useMemo(() => {
    const q = query.trim().toLowerCase();
    const deps = (data.departments || []).map((d) => {
      let employees = d.employees || [];
      if (q) {
        employees = employees.filter((e) => (
          (e.full_name || '').toLowerCase().includes(q)
          || (e.position || '').toLowerCase().includes(q)
          || (e.tab_no || '').toLowerCase().includes(q)
          || (e.department || '').toLowerCase().includes(q)
        ));
      }
      return {
        ...d,
        name: (d.name || 'BOSHQALAR').toUpperCase(),
        employees: employees.map((emp, idx) => ({ ...emp, _num: idx + 1 })),
      };
    }).filter((d) => d.employees.length > 0);
    return deps;
  }, [data.departments, query]);

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

  const sheetDate = shiftDate || todayLocalIso();

  return (
    <>
      {Toast}
      <Modal
        title={branchName ? `Зарплата · ${branchName}` : 'Зарплата'}
        onClose={onClose}
        wide
        className="modal-payroll modal-payroll-sheet"
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
        <div className="payroll-sheet-head">
          <div className="payroll-sheet-sana">
            SANA:
            {' '}
            <strong>{formatDate(sheetDate)}</strong>
          </div>
          <div className="payroll-sheet-brand">
            {branchName || 'Филиал'}
          </div>
        </div>

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
          <span className="payroll-debt-total">
            Долг всего: <strong>{formatMoney(data.total_debt || 0)}</strong>
          </span>
        </div>

        {loading ? (
          <p className="payroll-empty">Загрузка…</p>
        ) : sheetDepartments.length === 0 ? (
          <p className="payroll-empty">
            Нет сотрудников этого филиала. Нажмите «Синхр. сотрудников» после настройки Face ID.
          </p>
        ) : (
          <div className="payroll-sheet-grid">
            {sheetDepartments.map((dep) => (
              <section key={dep.name} className="payroll-sheet-table-wrap">
                <table className="payroll-sheet-table">
                  <thead>
                    <tr>
                      <th className="col-num">№</th>
                      <th className="col-name">{dep.name}</th>
                      <th className="col-oylik">OYLIK</th>
                      <th className="col-time">KIRISH — CHIQISH</th>
                      <th className="col-imzo">IMZO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dep.employees.map((emp) => {
                      const att = attendanceCells(emp);
                      const hasIn = att.kirish !== '—';
                      const hasOut = att.chiqish !== '—';
                      return (
                        <tr
                          key={emp.id}
                          className={canPay ? 'is-clickable' : undefined}
                          onClick={canPay ? () => openPay(emp) : undefined}
                        >
                          <td className="col-num">{emp._num}</td>
                          <td className="col-name">
                            <span className="payroll-sheet-fio">{emp.full_name}</span>
                            {emp.position && emp.position.toUpperCase() !== dep.name && (
                              <span className="payroll-sheet-pos">{emp.position}</span>
                            )}
                          </td>
                          <td className="col-oylik">
                            {Number(emp.balance) > 0 ? formatMoney(emp.balance) : ''}
                          </td>
                          <td className="col-time">
                            <span className="payroll-sheet-times">
                              <span className={att.kirish !== '—' ? 'is-set' : ''}>{att.kirish}</span>
                              <span className="payroll-sheet-times-sep">/</span>
                              <span className={att.chiqish !== '—' ? 'is-set' : ''}>{att.chiqish}</span>
                            </span>
                          </td>
                          <td className="col-imzo">
                            <span className="payroll-imzo" aria-hidden>
                              <span className={`payroll-imzo-box${hasIn ? ' is-checked' : ''}`} />
                              <span className={`payroll-imzo-box${hasOut ? ' is-checked' : ''}`} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
            {branchName && <>Филиал: <strong>{branchName}</strong>. </>}
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
