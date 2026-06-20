import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, formatDate, formatMoney, formatPriceInput, parsePriceInput, STATUS_LABELS,
} from '../api';
import { useToast } from '../components/Modal';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import ProductSelect from '../components/ProductSelect';
import { encodeProductPick, resolvePickFromProducts } from '../utils/productVariants';
import { hasPermission } from '../permissions';
import { todayLocalIso } from '../utils/date';

const LINE_LABELS = {
  stock: 'Остаток товара',
  debtor: 'Клиент должен',
  creditor: 'Долг поставщику',
  cash: 'Касса',
  bank: 'Банк / счёт',
};

const emptyLine = (lineType) => ({
  line_type: lineType,
  product_id: '',
  variant_id: null,
  department_id: '',
  counterparty_id: '',
  quantity: 0,
  unit_cost: 0,
  amount: 0,
  comment: '',
});

const emptyDoc = {
  date: todayLocalIso(),
  comment: '',
  lines: [],
};

function formatQty(n) {
  const value = Number(n) || 0;
  if (Number.isInteger(value)) return String(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}

function statusClass(status) {
  if (status === 'confirmed') return 'badge-confirmed';
  if (status === 'cancelled') return 'badge-cancelled';
  return 'badge-draft';
}

export default function OpeningBalance() {
  const [view, setView] = useState('list');
  const [documents, setDocuments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [form, setForm] = useState(emptyDoc);
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [products, setProducts] = useState([]);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const canEdit = hasPermission(user, 'opening_balance.edit');

  const isReadOnly = !canEdit || (editId && form.status && form.status !== 'draft');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getOpeningBalance();
      setSummary(data.summary);
      setDocuments(data.documents || []);
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, show]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      api.getDepartments({ active: '1' }),
      api.getCounterparties(),
      api.getProducts({ archived: '0' }),
    ]).then(([depts, cps, prods]) => {
      setDepartments(depts);
      setCounterparties(cps);
      setProducts(Array.isArray(prods) ? prods : []);
    }).catch(console.error);
  }, [branchId]);

  const openCreate = () => {
    setEditId(null);
    setForm({ ...emptyDoc, date: todayLocalIso(), lines: [emptyLine('cash')] });
    setView('edit');
  };

  const openDoc = async (id) => {
    try {
      const doc = await api.getOpeningBalanceDocument(id);
      setEditId(id);
      setForm({
        date: doc.date?.slice(0, 10) || todayLocalIso(),
        comment: doc.comment || '',
        status: doc.status,
        number: doc.number,
        lines: (doc.lines || []).map((l) => ({
          line_type: l.line_type,
          product_id: l.product_id || '',
          variant_id: l.variant_id || null,
          department_id: l.department_id || '',
          counterparty_id: l.counterparty_id || '',
          quantity: l.quantity || 0,
          unit_cost: l.unit_cost || 0,
          amount: l.amount || 0,
          comment: l.comment || '',
        })),
      });
      setView('edit');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const addLine = (lineType) => {
    setForm((f) => ({ ...f, lines: [...f.lines, emptyLine(lineType)] }));
  };

  const updateLine = (index, patch) => {
    setForm((f) => {
      const lines = [...f.lines];
      lines[index] = { ...lines[index], ...patch };
      if (lines[index].line_type === 'stock') {
        lines[index].amount = (Number(lines[index].quantity) || 0) * (Number(lines[index].unit_cost) || 0);
      }
      return { ...f, lines };
    });
  };

  const removeLine = (index) => {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }));
  };

  const docTotal = useMemo(
    () => form.lines.reduce((s, l) => {
      if (l.line_type === 'stock') return s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0);
      return s + (Number(l.amount) || 0);
    }, 0),
    [form.lines],
  );

  const save = async (andConfirm = false) => {
    if (!canEdit) return;
    if (!form.date) {
      show('Укажите дату документа', 'error');
      return;
    }
    if (form.lines.length === 0) {
      show('Добавьте строки', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date: form.date,
        comment: form.comment,
        lines: form.lines,
      };
      let doc;
      if (editId) {
        doc = await api.updateOpeningBalanceDocument(editId, payload);
      } else {
        doc = await api.createOpeningBalanceDocument(payload);
        setEditId(doc.id);
      }
      if (andConfirm) {
        doc = await api.confirmOpeningBalanceDocument(doc.id);
        show('Документ проведён');
      } else {
        show('Черновик сохранён');
      }
      await load();
      setForm({
        date: doc.date?.slice(0, 10),
        comment: doc.comment || '',
        status: doc.status,
        number: doc.number,
        lines: (doc.lines || []).map((l) => ({
          line_type: l.line_type,
          product_id: l.product_id || '',
          variant_id: l.variant_id || null,
          department_id: l.department_id || '',
          counterparty_id: l.counterparty_id || '',
          quantity: l.quantity || 0,
          unit_cost: l.unit_cost || 0,
          amount: l.amount || 0,
          comment: l.comment || '',
        })),
      });
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDoc = async () => {
    if (!editId) return save(true);
    setSaving(true);
    try {
      await api.confirmOpeningBalanceDocument(editId);
      show('Документ проведён');
      await load();
      await openDoc(editId);
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelDoc = async () => {
    if (!editId || !window.confirm('Отменить проведение? Остатки товаров из документа будут обнулены.')) return;
    setSaving(true);
    try {
      await api.cancelOpeningBalanceDocument(editId);
      show('Документ отменён');
      await load();
      await openDoc(editId);
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeDoc = async (id) => {
    if (!window.confirm('Удалить черновик?')) return;
    try {
      await api.deleteOpeningBalanceDocument(id);
      show('Удалено');
      if (editId === id) {
        setView('list');
        setEditId(null);
      }
      await load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const clients = counterparties.filter((c) => c.type === 'client');
  const suppliers = counterparties.filter((c) => c.type === 'supplier');

  return (
    <div className="opening-balance-page">
      {Toast}
      <div className="page-header">
        <h1>Начальное сальдо</h1>
        <div className="btn-group">
          <BranchChip>{branchName}</BranchChip>
          {canEdit && view === 'list' && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>+ Новый документ</button>
          )}
          {view === 'edit' && (
            <button type="button" className="btn btn-ghost" onClick={() => setView('list')}>← К списку</button>
          )}
        </div>
      </div>

      <p className="page-hint">
        Начальное сальдо оформляется документом с датой. После проведения остатки товаров, долги, касса и банк
        учитываются в отчётах; операции кассы после даты документа пересчитывают текущую сумму в кассе.
      </p>

      {summary && view === 'list' && (
        <div className="stock-report-kpi" style={{ marginBottom: 16 }}>
          <div className="stat-card stock-kpi-card">
            <span className="label">Склад</span>
            <span className="value">{formatMoney(summary.stock?.value || 0)}</span>
          </div>
          <div className="stat-card stock-kpi-card debt-kpi-debtors">
            <span className="label">Нам должны</span>
            <span className="value">{formatMoney(summary.debtors?.total || 0)}</span>
          </div>
          <div className="stat-card stock-kpi-card debt-kpi-creditors">
            <span className="label">Мы должны</span>
            <span className="value">{formatMoney(summary.creditors?.total || 0)}</span>
          </div>
          <div className="stat-card stock-kpi-card">
            <span className="label">Касса</span>
            <span className="value">{formatMoney(summary.money?.current_cash || 0)}</span>
            <span className="stock-kpi-hint">начало: {formatMoney(summary.money?.opening_cash || 0)}</span>
          </div>
          <div className="stat-card stock-kpi-card">
            <span className="label">Банк</span>
            <span className="value">{formatMoney(summary.money?.current_bank || 0)}</span>
          </div>
          <div className="stat-card stock-kpi-card">
            <span className="label">Чистая позиция</span>
            <span className="value">{formatMoney(summary.net_position || 0)}</span>
            {summary.money?.start_date && (
              <span className="stock-kpi-hint">с {formatDate(summary.money.start_date)}</span>
            )}
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="card">
          <div className="card-header">
            <strong>Документы начального сальдо</strong>
            <span className="report-meta">{loading ? 'Загрузка…' : `${documents.length} шт.`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th className="col-num">Сумма</th>
                  <th>Комментарий</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.number}</td>
                    <td>{formatDate(d.date)}</td>
                    <td><span className={`badge ${statusClass(d.status)}`}>{STATUS_LABELS[d.status] || d.status}</span></td>
                    <td className="col-num">{formatMoney(d.total_amount)}</td>
                    <td>{d.comment || '—'}</td>
                    <td>
                      <div className="btn-group btn-group-icons">
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => openDoc(d.id)}>Открыть</button>
                        {canEdit && d.status === 'draft' && (
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => removeDoc(d.id)}>Удалить</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && documents.length === 0 && (
                  <tr><td colSpan={6} className="empty">Нет документов — создайте первый</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'edit' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <strong>
                {editId ? `Документ №${form.number || '…'}` : 'Новый документ'}
                {form.status && (
                  <span className={`badge ${statusClass(form.status)}`} style={{ marginLeft: 8 }}>
                    {STATUS_LABELS[form.status]}
                  </span>
                )}
              </strong>
              <span className="report-meta">Итого: {formatMoney(docTotal)}</span>
            </div>
            <div className="form-grid" style={{ padding: 16 }}>
              <div className="form-group">
                <label>Дата документа *</label>
                <input
                  type="date"
                  value={form.date}
                  disabled={isReadOnly}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="form-group form-group-full">
                <label>Комментарий</label>
                <input
                  value={form.comment}
                  disabled={isReadOnly}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                  placeholder="Например: перенос из Excel на 01.01.2026"
                />
              </div>
            </div>
          </div>

          {!isReadOnly && (
            <div className="btn-group" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => addLine('stock')}>+ Товар</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => addLine('debtor')}>+ Дебитор</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => addLine('creditor')}>+ Кредитор</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => addLine('cash')}>+ Касса</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => addLine('bank')}>+ Банк</button>
            </div>
          )}

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Тип</th>
                    <th>Детали</th>
                    <th className="col-num">Кол-во</th>
                    <th className="col-num">Цена/сумма</th>
                    <th className="col-num">Итого</th>
                    {!isReadOnly && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, index) => {
                    const lineTotal = line.line_type === 'stock'
                      ? (Number(line.quantity) || 0) * (Number(line.unit_cost) || 0)
                      : (Number(line.amount) || 0);
                    return (
                      <tr key={`line-${index}`}>
                        <td>{LINE_LABELS[line.line_type]}</td>
                        <td>
                          {line.line_type === 'stock' && (
                            <div className="form-grid" style={{ gap: 8 }}>
                              <select
                                value={line.department_id}
                                disabled={isReadOnly}
                                onChange={(e) => updateLine(index, { department_id: e.target.value })}
                              >
                                <option value="">Склад…</option>
                                {departments.map((d) => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                              <ProductSelect
                                products={products}
                                value={encodeProductPick(line.product_id, line.variant_id)}
                                disabled={isReadOnly}
                                onChange={(pickValue) => {
                                  const pick = resolvePickFromProducts(products, pickValue);
                                  if (pick) {
                                    updateLine(index, {
                                      product_id: pick.product_id,
                                      variant_id: pick.variant_id,
                                    });
                                  }
                                }}
                              />
                            </div>
                          )}
                          {(line.line_type === 'debtor' || line.line_type === 'creditor') && (
                            <select
                              value={line.counterparty_id}
                              disabled={isReadOnly}
                              onChange={(e) => updateLine(index, { counterparty_id: e.target.value })}
                            >
                              <option value="">Контрагент…</option>
                              {(line.line_type === 'debtor' ? clients : suppliers).map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          )}
                          {(line.line_type === 'cash' || line.line_type === 'bank') && (
                            <span className="text-muted">Остаток на дату документа</span>
                          )}
                        </td>
                        <td className="col-num">
                          {line.line_type === 'stock' && !isReadOnly ? (
                            <input
                              type="number"
                              min="0"
                              step="any"
                              className="input-compact input-num"
                              value={line.quantity}
                              onChange={(e) => updateLine(index, { quantity: parseFloat(e.target.value) || 0 })}
                            />
                          ) : line.line_type === 'stock' ? formatQty(line.quantity) : '—'}
                        </td>
                        <td className="col-num">
                          {!isReadOnly ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              className="input-compact input-num"
                              value={formatPriceInput(line.line_type === 'stock' ? line.unit_cost : line.amount)}
                              onChange={(e) => {
                                const val = parsePriceInput(e.target.value) ?? 0;
                                updateLine(index, line.line_type === 'stock' ? { unit_cost: val } : { amount: val });
                              }}
                            />
                          ) : formatMoney(line.line_type === 'stock' ? line.unit_cost : line.amount)}
                        </td>
                        <td className="col-num">{formatMoney(lineTotal)}</td>
                        {!isReadOnly && (
                          <td>
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => removeLine(index)}>×</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {form.lines.length === 0 && (
                    <tr><td colSpan={isReadOnly ? 5 : 6} className="empty">Добавьте строки</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(!form.status || form.status === 'draft') && (
                  <>
                    <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save(false)}>
                      {saving ? '…' : 'Сохранить черновик'}
                    </button>
                    <button type="button" className="btn btn-prihod" disabled={saving} onClick={confirmDoc}>
                      Провести
                    </button>
                  </>
                )}
                {form.status === 'confirmed' && (
                  <button type="button" className="btn btn-danger" disabled={saving} onClick={cancelDoc}>
                    Отменить проведение
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
