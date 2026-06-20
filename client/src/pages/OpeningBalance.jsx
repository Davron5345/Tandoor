import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate, formatMoney, formatPriceInput, parsePriceInput } from '../api';
import { useToast } from '../components/Modal';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import { hasPermission } from '../permissions';
import { todayLocalIso } from '../utils/date';

const TABS = [
  { id: 'summary', label: 'Сводка' },
  { id: 'stock', label: 'Остатки товаров' },
  { id: 'counterparties', label: 'Задолженности' },
  { id: 'settings', label: 'Настройки' },
];

function formatQty(n) {
  const value = Number(n) || 0;
  if (Number.isInteger(value)) return String(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

export default function OpeningBalance() {
  const [tab, setTab] = useState('summary');
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState({ as_of_date: '', cash_balance: 0, notes: '' });
  const [counterparties, setCounterparties] = useState([]);
  const [cpDraft, setCpDraft] = useState({});
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [stockLines, setStockLines] = useState([]);
  const [stockDraft, setStockDraft] = useState({});
  const [stockSearch, setStockSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const canEdit = hasPermission(user, 'opening_balance.edit');

  const loadMain = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getOpeningBalance();
      setSummary(data.summary);
      setSettings({
        as_of_date: data.settings?.as_of_date || '',
        cash_balance: data.settings?.cash_balance || 0,
        notes: data.settings?.notes || '',
      });
      const cps = data.counterparties || [];
      setCounterparties(cps);
      const cpMap = {};
      for (const c of cps) cpMap[c.id] = c.opening_balance || 0;
      setCpDraft(cpMap);
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, show]);

  const loadStock = useCallback(async () => {
    if (!departmentId) {
      setStockLines([]);
      return;
    }
    try {
      const data = await api.getOpeningStock({ department_id: departmentId });
      setDepartments(data.departments || []);
      setStockLines(data.lines || []);
      const draft = {};
      for (const line of data.lines || []) {
        draft[line.row_key] = {
          quantity: line.quantity,
          unit_cost: line.unit_cost,
        };
      }
      setStockDraft(draft);
    } catch (e) {
      show(e.message, 'error');
    }
  }, [departmentId, branchId, show]);

  useEffect(() => { loadMain(); }, [loadMain]);
  useEffect(() => {
    api.getDepartments({ active: '1' }).then((list) => {
      setDepartments(list);
      if (!departmentId && list.length === 1) setDepartmentId(list[0].id);
    }).catch(console.error);
  }, [branchId]);

  useEffect(() => {
    if (tab === 'stock') loadStock();
  }, [tab, loadStock]);

  const filteredStock = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    if (!q) return stockLines;
    return stockLines.filter((line) => (line.name || '').toLowerCase().includes(q));
  }, [stockLines, stockSearch]);

  const saveSettings = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const saved = await api.saveOpeningSettings({
        as_of_date: settings.as_of_date || null,
        cash_balance: Number(settings.cash_balance) || 0,
        notes: settings.notes,
      });
      setSettings({
        as_of_date: saved.as_of_date || '',
        cash_balance: saved.cash_balance || 0,
        notes: saved.notes || '',
      });
      await loadMain();
      show('Настройки сохранены');
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveCounterparties = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const items = counterparties.map((c) => ({
        id: c.id,
        opening_balance: Number(cpDraft[c.id]) || 0,
      }));
      await api.saveOpeningCounterparties(items);
      await loadMain();
      show('Начальные сальдо контрагентов сохранены');
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveStock = async () => {
    if (!canEdit || !departmentId) return;
    setSaving(true);
    try {
      const lines = stockLines.map((line) => {
        const draft = stockDraft[line.row_key] || {};
        return {
          product_id: line.product_id,
          variant_id: line.variant_id,
          name: line.name,
          quantity: draft.quantity ?? line.quantity,
          unit_cost: draft.unit_cost ?? line.unit_cost,
        };
      });
      await api.saveOpeningStock({ department_id: departmentId, lines });
      await loadStock();
      await loadMain();
      show('Остатки сохранены');
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateStockField = (rowKey, field, rawValue) => {
    setStockDraft((prev) => ({
      ...prev,
      [rowKey]: {
        ...prev[rowKey],
        [field]: field === 'quantity' ? (parseFloat(rawValue) || 0) : (parsePriceInput(rawValue) ?? 0),
      },
    }));
  };

  const netPosition = summary?.net_position ?? 0;

  return (
    <div className="opening-balance-page">
      {Toast}
      <div className="page-header">
        <h1>Начальное сальдо</h1>
        <BranchChip>{branchName}</BranchChip>
      </div>

      <p className="page-hint">
        Укажите стартовые данные на момент начала учёта в системе: остатки на складе,
        долги клиентов и поставщиков, сумма в кассе. Эти значения учитываются в отчётах по задолженностям и сводке бизнеса.
      </p>

      <div className="debt-kind-tabs" role="tablist" aria-label="Разделы начального сальдо">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`debt-kind-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="opening-summary">
          {loading ? (
            <div className="card"><div className="empty" style={{ padding: 24 }}>Загрузка…</div></div>
          ) : (
            <>
              <div className="stock-report-kpi">
                <div className="stat-card stock-kpi-card">
                  <span className="label">Товары на складе</span>
                  <span className="value">{formatMoney(summary?.stock?.value || 0)}</span>
                  <span className="stock-kpi-hint">{summary?.stock?.sku_count || 0} позиций</span>
                </div>
                <div className="stat-card stock-kpi-card debt-kpi-debtors">
                  <span className="label">Нам должны</span>
                  <span className="value">{formatMoney(summary?.debtors?.total || 0)}</span>
                  {summary?.debtors?.opening_total > 0 && (
                    <span className="stock-kpi-hint">из них нач. сальдо: {formatMoney(summary.debtors.opening_total)}</span>
                  )}
                </div>
                <div className="stat-card stock-kpi-card debt-kpi-creditors">
                  <span className="label">Мы должны</span>
                  <span className="value">{formatMoney(summary?.creditors?.total || 0)}</span>
                  {summary?.creditors?.opening_total > 0 && (
                    <span className="stock-kpi-hint">из них нач. сальдо: {formatMoney(summary.creditors.opening_total)}</span>
                  )}
                </div>
                <div className="stat-card stock-kpi-card">
                  <span className="label">Касса сейчас</span>
                  <span className="value">{formatMoney(summary?.cash?.current || 0)}</span>
                  <span className="stock-kpi-hint">начало: {formatMoney(summary?.cash?.opening_cash || 0)}</span>
                </div>
              </div>
              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-header">
                  <strong>Чистая позиция бизнеса</strong>
                  <span className="report-meta">
                    {summary?.settings?.as_of_date
                      ? `с ${formatDate(summary.settings.as_of_date)}`
                      : 'дата начала учёта не задана'}
                  </span>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <p style={{ margin: '0 0 8px', color: 'var(--text-muted)' }}>
                    Склад + дебиторы − кредиторы + касса
                  </p>
                  <p style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700 }}>
                    {formatMoney(netPosition)}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="card">
          <div className="card-header"><strong>Общие настройки</strong></div>
          <div className="form-grid" style={{ padding: 16 }}>
            <div className="form-group">
              <label>Дата начала учёта</label>
              <input
                type="date"
                value={settings.as_of_date || ''}
                max={todayLocalIso()}
                disabled={!canEdit}
                onChange={(e) => setSettings({ ...settings, as_of_date: e.target.value })}
              />
              <small className="text-muted" style={{ display: 'block', marginTop: 4 }}>Операции кассы после этой даты прибавляются к начальному остатку</small>
            </div>
            <div className="form-group">
              <label>Начальный остаток кассы</label>
              <input
                type="text"
                inputMode="numeric"
                disabled={!canEdit}
                value={formatPriceInput(settings.cash_balance)}
                onChange={(e) => setSettings({
                  ...settings,
                  cash_balance: parsePriceInput(e.target.value) ?? 0,
                })}
              />
            </div>
            <div className="form-group form-group-full">
              <label>Примечание</label>
              <textarea
                rows={3}
                disabled={!canEdit}
                value={settings.notes}
                onChange={(e) => setSettings({ ...settings, notes: e.target.value })}
                placeholder="Например: перенос из Excel, инвентаризация на 01.01.2026"
              />
            </div>
          </div>
          {canEdit && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveSettings}>
                {saving ? 'Сохранение…' : 'Сохранить настройки'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'counterparties' && (
        <div className="card">
          <div className="card-header">
            <strong>Начальное сальдо контрагентов</strong>
            <span className="report-meta">{counterparties.length} записей</span>
          </div>
          <p style={{ padding: '0 16px', margin: '12px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Положительная сумма: клиент должен нам / мы должны поставщику. Отрицательная — аванс или переплата.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Контрагент</th>
                  <th>Тип</th>
                  <th className="col-num">Нач. сальдо</th>
                </tr>
              </thead>
              <tbody>
                {counterparties.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>
                      <span className={`badge badge-${c.type}`}>
                        {c.type === 'supplier' ? 'Поставщик' : 'Клиент'}
                      </span>
                    </td>
                    <td className="col-num">
                      {canEdit ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          className="input-compact input-num"
                          value={formatPriceInput(cpDraft[c.id] ?? 0)}
                          onChange={(e) => setCpDraft({
                            ...cpDraft,
                            [c.id]: parsePriceInput(e.target.value) ?? 0,
                          })}
                        />
                      ) : formatMoney(cpDraft[c.id] ?? 0)}
                    </td>
                  </tr>
                ))}
                {counterparties.length === 0 && (
                  <tr><td colSpan={3} className="empty">Нет контрагентов — добавьте в справочнике</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {canEdit && counterparties.length > 0 && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveCounterparties}>
                {saving ? 'Сохранение…' : 'Сохранить задолженности'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'stock' && (
        <>
          <div className="card stock-report-toolbar">
            <div className="stock-toolbar-grid">
              <label>
                Склад (отдел)
                <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">— выберите —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <div className="stock-search-wrap">
                <span className="stock-search-icon" aria-hidden="true">⌕</span>
                <input
                  type="search"
                  className="stock-search-input"
                  placeholder="Поиск товара..."
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
          {!departmentId ? (
            <div className="card"><div className="empty" style={{ padding: 24 }}>Выберите склад для ввода остатков</div></div>
          ) : (
            <div className="card">
              <div className="card-header">
                <strong>Остатки на складе</strong>
                <span className="report-meta">{filteredStock.length} позиций</span>
              </div>
              <p style={{ padding: '0 16px', margin: '12px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Укажите фактическое количество и себестоимость на дату начала учёта. Значения заменяют текущие остатки по выбранному складу.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Товар</th>
                      <th>Ед.</th>
                      <th className="col-num">Кол-во</th>
                      <th className="col-num">Себестоимость</th>
                      <th className="col-num">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStock.map((line) => {
                      const draft = stockDraft[line.row_key] || {};
                      const qty = draft.quantity ?? line.quantity;
                      const cost = draft.unit_cost ?? line.unit_cost;
                      return (
                        <tr key={line.row_key}>
                          <td>{line.name}</td>
                          <td>{line.unit}</td>
                          <td className="col-num">
                            {canEdit ? (
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className="input-compact input-num"
                                value={qty}
                                onChange={(e) => updateStockField(line.row_key, 'quantity', e.target.value)}
                              />
                            ) : formatQty(qty)}
                          </td>
                          <td className="col-num">
                            {canEdit ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                className="input-compact input-num"
                                value={formatPriceInput(cost)}
                                onChange={(e) => updateStockField(line.row_key, 'unit_cost', e.target.value)}
                              />
                            ) : formatMoney(cost)}
                          </td>
                          <td className="col-num">{formatMoney(qty * cost)}</td>
                        </tr>
                      );
                    })}
                    {filteredStock.length === 0 && (
                      <tr><td colSpan={5} className="empty">Нет товаров</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {canEdit && filteredStock.length > 0 && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={saveStock}>
                    {saving ? 'Сохранение…' : 'Сохранить остатки'}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
