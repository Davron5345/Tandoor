import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api, formatDate, formatMoney, formatPriceInput, parsePriceInput, normalizeQuantityInput, parseQuantityInput, STATUS_LABELS,
} from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import ProductSelect from '../components/ProductSelect';
import { encodeProductPick, resolvePickFromProducts } from '../utils/productVariants';
import { hasPermission } from '../permissions';
import { todayLocalIso } from '../utils/date';

const LINE_LABELS = {
  stock: 'Склад',
  debtor: 'Дебиторская задолженность',
  creditor: 'Кредиторская задолженность',
  cash: 'Касса',
  bank: 'Банк',
};

const CREATE_DOC_OPTIONS = [
  { type: 'stock', label: 'Склад', hint: 'Товары и остатки на складах на дату начала учёта' },
  { type: 'cash', label: 'Касса', hint: 'Остаток наличных в кассе на дату документа' },
  { type: 'bank', label: 'Банк', hint: 'Остаток на расчётном счёте на дату документа' },
  { type: 'debtor', label: 'Дебиторская задолженность', hint: 'Суммы, которые клиенты должны на дату начала учёта' },
  { type: 'creditor', label: 'Кредиторская задолженность', hint: 'Суммы, которые вы должны поставщикам на дату начала учёта' },
];

const CREATE_MODAL_WIDE = new Set(['stock', 'debtor', 'creditor']);

function createModalTitle(type) {
  return CREATE_DOC_OPTIONS.find((o) => o.type === type)?.label || 'Документ';
}

function createModalHint(type) {
  return CREATE_DOC_OPTIONS.find((o) => o.type === type)?.hint || '';
}

const SECTIONS = [
  {
    id: 'money',
    title: 'Деньги',
    hint: 'Остаток в кассе и на расчётном счёте на дату документа',
    types: ['cash', 'bank'],
    addLabel: '+ Касса / банк',
  },
  {
    id: 'debts',
    title: 'Задолженности',
    hint: 'Кто кому должен на момент начала учёта',
    types: ['debtor', 'creditor'],
    addLabel: '+ Контрагент',
  },
  {
    id: 'stock',
    title: 'Товары на складе',
    hint: 'Количество и себестоимость по каждому складу',
    types: ['stock'],
    addLabel: '+ Товар',
  },
];

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

function lineBadgeClass(type) {
  return `ob-line-badge ob-line-badge-${type}`;
}

function lineTotal(line) {
  if (line.line_type === 'stock') {
    return (parseQuantityInput(line.quantity) ?? 0) * (Number(line.unit_cost) || 0);
  }
  return Number(line.amount) || 0;
}

function defaultNewDocLines(lineType) {
  if (lineType) return [emptyLine(lineType)];
  return [emptyLine('cash'), emptyLine('bank')];
}

function isCreateFormDirty(form, lineType) {
  if (form.comment?.trim()) return true;
  return form.lines.some((line) => {
    if (line.line_type !== lineType) return false;
    if (line.comment?.trim()) return true;
    if (line.line_type === 'stock') {
      return line.product_id || line.department_id || Number(line.quantity) > 0 || Number(line.unit_cost) > 0;
    }
    if (line.line_type === 'debtor' || line.line_type === 'creditor') {
      return line.counterparty_id || Number(line.amount) > 0;
    }
    return Number(line.amount) > 0;
  });
}

function CreateDocumentMenu({ onSelect, buttonClassName = 'btn btn-primary' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (type) => {
    setOpen(false);
    onSelect(type);
  };

  return (
    <div className="ob-create-menu" ref={rootRef}>
      <button
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Создать документ
        <span className="ob-create-menu-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="ob-create-menu-list" role="menu">
          {CREATE_DOC_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              type="button"
              role="menuitem"
              className="ob-create-menu-item"
              onClick={() => pick(opt.type)}
            >
              <span className="ob-create-menu-item-label">{opt.label}</span>
              <span className="ob-create-menu-item-hint">{opt.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  const [createModalType, setCreateModalType] = useState(null);
  const [createForm, setCreateForm] = useState(emptyDoc);
  const [createSaving, setCreateSaving] = useState(false);
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

  const openCreate = (lineType) => {
    setCreateForm({
      ...emptyDoc,
      date: todayLocalIso(),
      lines: defaultNewDocLines(lineType),
    });
    setCreateModalType(lineType);
  };

  const closeCreateModal = () => {
    setCreateModalType(null);
    setCreateForm(emptyDoc);
  };

  const updateCreateLine = (index, patch) => {
    setCreateForm((f) => {
      const lines = [...f.lines];
      lines[index] = { ...lines[index], ...patch };
      if (lines[index].line_type === 'stock') {
        lines[index].amount = (parseQuantityInput(lines[index].quantity) ?? 0) * (Number(lines[index].unit_cost) || 0);
      }
      return { ...f, lines };
    });
  };

  const addCreateLine = (lineType) => {
    setCreateForm((f) => ({ ...f, lines: [...f.lines, emptyLine(lineType)] }));
  };

  const removeCreateLine = (index) => {
    setCreateForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }));
  };

  const saveCreateModal = async (andConfirm = false) => {
    if (!canEdit || !createModalType) return;
    if (!createForm.date) {
      show('Укажите дату документа', 'error');
      return;
    }
    const lines = createForm.lines.filter((l) => l.line_type === createModalType);
    if (lines.length === 0) {
      show('Добавьте хотя бы одну строку', 'error');
      return;
    }
    setCreateSaving(true);
    try {
      let doc = await api.createOpeningBalanceDocument({
        date: createForm.date,
        comment: createForm.comment,
        lines,
      });
      if (andConfirm) {
        doc = await api.confirmOpeningBalanceDocument(doc.id);
        show('Документ проведён');
      } else {
        show('Черновик сохранён');
      }
      await load();
      closeCreateModal();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setCreateSaving(false);
    }
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
          quantity: parseQuantityInput(l.quantity) ?? 0,
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

  const addSectionLine = (section) => {
    if (section.id === 'money') {
      const hasCash = form.lines.some((l) => l.line_type === 'cash');
      addLine(hasCash ? 'bank' : 'cash');
      return;
    }
    if (section.id === 'debts') {
      addLine('debtor');
      return;
    }
    addLine('stock');
  };

  const updateLine = (index, patch) => {
    setForm((f) => {
      const lines = [...f.lines];
      lines[index] = { ...lines[index], ...patch };
      if (lines[index].line_type === 'stock') {
        lines[index].amount = (parseQuantityInput(lines[index].quantity) ?? 0) * (Number(lines[index].unit_cost) || 0);
      }
      return { ...f, lines };
    });
  };

  const removeLine = (index) => {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }));
  };

  const docTotal = useMemo(
    () => form.lines.reduce((s, l) => s + lineTotal(l), 0),
    [form.lines],
  );

  const formTotals = useMemo(() => {
    const t = { stock: 0, debtor: 0, creditor: 0, cash: 0, bank: 0 };
    for (const line of form.lines) {
      t[line.line_type] = (t[line.line_type] || 0) + lineTotal(line);
    }
    return t;
  }, [form.lines]);

  const syncFormFromDoc = (doc) => {
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
        quantity: parseQuantityInput(l.quantity) ?? 0,
        unit_cost: l.unit_cost || 0,
        amount: l.amount || 0,
        comment: l.comment || '',
      })),
    });
  };

  const save = async (andConfirm = false) => {
    if (!canEdit) return;
    if (!form.date) {
      show('Укажите дату документа', 'error');
      return;
    }
    if (form.lines.length === 0) {
      show('Добавьте хотя бы одну строку', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { date: form.date, comment: form.comment, lines: form.lines };
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
      syncFormFromDoc(doc);
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
      const doc = await api.confirmOpeningBalanceDocument(editId);
      show('Документ проведён');
      await load();
      syncFormFromDoc(doc);
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
      const doc = await api.cancelOpeningBalanceDocument(editId);
      show('Документ отменён');
      await load();
      syncFormFromDoc(doc);
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
  const hasConfirmedDoc = documents.some((d) => d.status === 'confirmed');

  const renderLineRow = (line, index, ctx) => {
    const {
      isReadOnly: readOnly,
      onUpdate,
      onRemove,
      clientList,
      supplierList,
    } = ctx;
    const total = lineTotal(line);
    return (
      <tr key={`line-${index}`}>
        <td className="ob-line-type">
          <span className={lineBadgeClass(line.line_type)}>{LINE_LABELS[line.line_type]}</span>
        </td>
        <td className="ob-line-details">
          {line.line_type === 'stock' && (
            <div className="form-grid">
              <select
                value={line.department_id}
                disabled={readOnly}
                onChange={(e) => onUpdate(index, { department_id: e.target.value })}
              >
                <option value="">Склад…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <ProductSelect
                products={products}
                value={encodeProductPick(line.product_id, line.variant_id)}
                disabled={readOnly}
                onChange={(pickValue) => {
                  const pick = resolvePickFromProducts(products, pickValue);
                  if (pick) {
                    onUpdate(index, { product_id: pick.product_id, variant_id: pick.variant_id });
                  }
                }}
              />
            </div>
          )}
          {(line.line_type === 'debtor' || line.line_type === 'creditor') && (
            <select
              value={line.counterparty_id}
              disabled={readOnly}
              onChange={(e) => onUpdate(index, { counterparty_id: e.target.value })}
            >
              <option value="">Выберите контрагента…</option>
              {(line.line_type === 'debtor' ? clientList : supplierList).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {(line.line_type === 'cash' || line.line_type === 'bank') && (
            <span className="text-muted">Сумма на дату документа</span>
          )}
        </td>
        <td className="col-num">
          {line.line_type === 'stock' && !readOnly ? (
            <input
              type="text"
              inputMode="decimal"
              className="input-compact input-num"
              value={line.quantity}
              onChange={(e) => onUpdate(index, { quantity: normalizeQuantityInput(e.target.value) })}
            />
          ) : line.line_type === 'stock' ? formatQty(line.quantity) : '—'}
        </td>
        <td className="col-num">
          {!readOnly ? (
            <input
              type="text"
              inputMode="numeric"
              className="input-compact input-num"
              value={formatPriceInput(line.line_type === 'stock' ? line.unit_cost : line.amount)}
              onChange={(e) => {
                const val = parsePriceInput(e.target.value) ?? 0;
                onUpdate(index, line.line_type === 'stock' ? { unit_cost: val } : { amount: val });
              }}
            />
          ) : formatMoney(line.line_type === 'stock' ? line.unit_cost : line.amount)}
        </td>
        <td className="col-num"><strong>{formatMoney(total)}</strong></td>
        {!readOnly && (
          <td>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemove(index)} aria-label="Удалить">×</button>
          </td>
        )}
      </tr>
    );
  };

  const editLineCtx = {
    isReadOnly,
    onUpdate: updateLine,
    onRemove: removeLine,
    clientList: clients,
    supplierList: suppliers,
  };

  const createLineCtx = {
    isReadOnly: false,
    onUpdate: updateCreateLine,
    onRemove: removeCreateLine,
    clientList: clients,
    supplierList: suppliers,
  };

  const createModalLines = useMemo(
    () => createForm.lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.line_type === createModalType),
    [createForm.lines, createModalType],
  );

  const createModalTotal = useMemo(
    () => createModalLines.reduce((s, { line }) => s + lineTotal(line), 0),
    [createModalLines],
  );

  const createModalDirty = createModalType
    ? isCreateFormDirty(createForm, createModalType)
    : false;

  const renderCreateModalBody = () => {
    if (!createModalType) return null;
    const isMoney = createModalType === 'cash' || createModalType === 'bank';
    const moneyLineIndex = createForm.lines.findIndex((l) => l.line_type === createModalType);

    return (
      <div className="ob-create-modal">
        <p className="ob-create-modal-hint">{createModalHint(createModalType)}</p>
        <div className="opening-balance-doc-meta">
          <div className="form-group">
            <label>Дата начала учёта *</label>
            <input
              type="date"
              value={createForm.date}
              onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Комментарий</label>
            <input
              value={createForm.comment}
              onChange={(e) => setCreateForm({ ...createForm, comment: e.target.value })}
              placeholder="Необязательно"
            />
          </div>
        </div>

        {isMoney ? (
          <div className="ob-create-modal-money">
            <div className="form-group">
              <label>Сумма *</label>
              <input
                type="text"
                inputMode="numeric"
                className="input-num"
                value={formatPriceInput(createForm.lines[moneyLineIndex]?.amount || 0)}
                onChange={(e) => {
                  const val = parsePriceInput(e.target.value) ?? 0;
                  updateCreateLine(moneyLineIndex, { amount: val });
                }}
                placeholder="0"
              />
            </div>
            <div className="ob-create-modal-total">
              Итого: <strong>{formatMoney(createModalTotal)}</strong>
            </div>
          </div>
        ) : (
          <>
            <div className="ob-create-modal-table-head">
              <strong>{createModalTitle(createModalType)}</strong>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => addCreateLine(createModalType)}
              >
                {createModalType === 'stock' ? '+ Товар' : '+ Контрагент'}
              </button>
            </div>
            {createModalLines.length === 0 ? (
              <div className="empty" style={{ padding: 20 }}>
                Нет строк — нажмите «{createModalType === 'stock' ? '+ Товар' : '+ Контрагент'}»
              </div>
            ) : (
              <div className="table-wrap">
                <table className="opening-balance-line-table">
                  <thead>
                    <tr>
                      <th>Тип</th>
                      <th>Детали</th>
                      <th className="col-num">Кол-во</th>
                      <th className="col-num">Сумма / цена</th>
                      <th className="col-num">Итого</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {createModalLines.map(({ line, index }) => renderLineRow(line, index, createLineCtx))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="ob-create-modal-total">
              Итого: <strong>{formatMoney(createModalTotal)}</strong>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="opening-balance-page">
      {Toast}

      <div className="page-header">
        <h1>Начальное сальдо</h1>
        <div className="btn-group">
          <BranchChip>{branchName}</BranchChip>
          {canEdit && view === 'list' && (
            <CreateDocumentMenu onSelect={openCreate} />
          )}
          {view === 'edit' && (
            <button type="button" className="btn btn-ghost" onClick={() => setView('list')}>← К списку</button>
          )}
        </div>
      </div>

      {view === 'list' && (
        <>
          {summary && (
            <div className="opening-balance-kpi">
              <div className="stat-card">
                <span className="label">Склад</span>
                <span className="value">{formatMoney(summary.stock?.value || 0)}</span>
              </div>
              <div className="stat-card debt-kpi-debtors">
                <span className="label">Дебиторская задолженность</span>
                <span className="value">{formatMoney(summary.debtors?.total || 0)}</span>
              </div>
              <div className="stat-card debt-kpi-creditors">
                <span className="label">Кредиторская задолженность</span>
                <span className="value">{formatMoney(summary.creditors?.total || 0)}</span>
              </div>
              <div className="stat-card">
                <span className="label">Касса</span>
                <span className="value">{formatMoney(summary.money?.current_cash || 0)}</span>
                <span className="stock-kpi-hint">начало {formatMoney(summary.money?.opening_cash || 0)}</span>
              </div>
              <div className="stat-card">
                <span className="label">Банк</span>
                <span className="value">{formatMoney(summary.money?.current_bank || 0)}</span>
              </div>
              <div className="stat-card ob-kpi-net">
                <span className="label">Чистая позиция</span>
                <span className="value">{formatMoney(summary.net_position || 0)}</span>
                {summary.money?.start_date ? (
                  <span className="stock-kpi-hint">учёт с {formatDate(summary.money.start_date)}</span>
                ) : (
                  <span className="stock-kpi-hint">проведите документ</span>
                )}
              </div>
            </div>
          )}

          {!loading && documents.length === 0 ? (
            <div className="card opening-balance-empty">
              <div className="opening-balance-empty-icon" aria-hidden>⚖️</div>
              <h2>Начните учёт с первого документа</h2>
              <p>
                Создайте документ начального сальдо с датой начала учёта. Укажите остатки в кассе и банке,
                долги контрагентов и товары на складе — после проведения сводка заполнится автоматически.
              </p>
              {canEdit && (
                <CreateDocumentMenu onSelect={openCreate} />
              )}
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <strong>Документы</strong>
                <span className="report-meta">{loading ? 'Загрузка…' : `${documents.length} шт.`}</span>
              </div>
              {!hasConfirmedDoc && documents.length > 0 && (
                <div className="alert" style={{ margin: '12px 16px 0' }}>
                  Проведите документ — только после этого суммы попадут в отчёты и сводку.
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>№</th>
                      <th>Дата</th>
                      <th>Статус</th>
                      <th className="col-num">Касса</th>
                      <th className="col-num">Банк</th>
                      <th className="col-num">Склад</th>
                      <th className="col-num">Итого</th>
                      <th>Комментарий</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((d) => (
                      <tr key={d.id}>
                        <td>{d.number}</td>
                        <td>{formatDate(d.date)}</td>
                        <td>
                          <span className={`badge ${statusClass(d.status)}`}>
                            {STATUS_LABELS[d.status] || d.status}
                          </span>
                        </td>
                        <td className="col-num">{formatMoney(d.totals?.cash || 0)}</td>
                        <td className="col-num">{formatMoney(d.totals?.bank || 0)}</td>
                        <td className="col-num">{formatMoney(d.totals?.stock || 0)}</td>
                        <td className="col-num"><strong>{formatMoney(d.total_amount)}</strong></td>
                        <td>{d.comment || '—'}</td>
                        <td>
                          <div className="btn-group">
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => openDoc(d.id)}>Открыть</button>
                            {canEdit && d.status === 'draft' && (
                              <button type="button" className="btn btn-sm btn-danger" onClick={() => removeDoc(d.id)}>Удалить</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {view === 'edit' && (
        <div className="opening-balance-sections">
          <div className="opening-balance-section">
            <div className="opening-balance-section-head">
              <div>
                <h3>{editId ? `Документ №${form.number || '…'}` : 'Создание документа начального сальдо'}</h3>
                <p>Дата документа определяет, с какого дня считаются операции кассы</p>
              </div>
              {form.status && (
                <span className={`badge ${statusClass(form.status)}`}>{STATUS_LABELS[form.status]}</span>
              )}
            </div>
            <div className="opening-balance-doc-meta">
              <div className="form-group">
                <label>Дата начала учёта *</label>
                <input
                  type="date"
                  value={form.date}
                  disabled={isReadOnly}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Комментарий</label>
                <input
                  value={form.comment}
                  disabled={isReadOnly}
                  onChange={(e) => setForm({ ...form, comment: e.target.value })}
                  placeholder="Например: перенос из Excel, инвентаризация"
                />
              </div>
            </div>
            <div className="opening-balance-doc-totals">
              <span>Касса: <strong>{formatMoney(formTotals.cash)}</strong></span>
              <span>Банк: <strong>{formatMoney(formTotals.bank)}</strong></span>
              <span>Дебиторская задолженность: <strong>{formatMoney(formTotals.debtor)}</strong></span>
              <span>Кредиторская задолженность: <strong>{formatMoney(formTotals.creditor)}</strong></span>
              <span>Склад: <strong>{formatMoney(formTotals.stock)}</strong></span>
              <span>Итого: <strong>{formatMoney(docTotal)}</strong></span>
            </div>
          </div>

          {SECTIONS.map((section) => {
            const indices = form.lines
              .map((line, index) => ({ line, index }))
              .filter(({ line }) => section.types.includes(line.line_type));
            return (
              <div key={section.id} className="opening-balance-section">
                <div className="opening-balance-section-head">
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.hint}</p>
                  </div>
                  {!isReadOnly && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => addSectionLine(section)}>
                      {section.addLabel}
                    </button>
                  )}
                </div>
                {indices.length === 0 ? (
                  <div className="empty" style={{ padding: 20 }}>Нет строк — нажмите «{section.addLabel}»</div>
                ) : (
                  <div className="table-wrap">
                    <table className="opening-balance-line-table">
                      <thead>
                        <tr>
                          <th>Тип</th>
                          <th>Детали</th>
                          <th className="col-num">Кол-во</th>
                          <th className="col-num">Сумма / цена</th>
                          <th className="col-num">Итого</th>
                          {!isReadOnly && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {indices.map(({ line, index }) => renderLineRow(line, index, editLineCtx))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {canEdit && (
            <div className="opening-balance-doc-actions">
              {(!form.status || form.status === 'draft') && (
                <>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save(false)}>
                    {saving ? 'Сохранение…' : 'Сохранить черновик'}
                  </button>
                  <button type="button" className="btn btn-prihod" disabled={saving} onClick={confirmDoc}>
                    Провести документ
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
      )}

      {createModalType && (
        <Modal
          title={createModalTitle(createModalType)}
          wide={CREATE_MODAL_WIDE.has(createModalType)}
          className="modal-ob-create"
          dirty={createModalDirty}
          onClose={closeCreateModal}
          footer={(
            <>
              <ModalCancelButton />
              <button
                type="button"
                className="btn btn-primary"
                disabled={createSaving}
                onClick={() => saveCreateModal(false)}
              >
                {createSaving ? 'Сохранение…' : 'Сохранить черновик'}
              </button>
              <button
                type="button"
                className="btn btn-prihod"
                disabled={createSaving}
                onClick={() => saveCreateModal(true)}
              >
                Провести
              </button>
            </>
          )}
        >
          {renderCreateModalBody()}
        </Modal>
      )}
    </div>
  );
}
