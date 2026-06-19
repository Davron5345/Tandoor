import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatMoney, formatPriceInput, parsePriceInput } from '../api';
import Modal, { useToast } from '../components/Modal';
import { IconButton, IconEdit, IconTrash } from '../components/ActionIcons';
import { canModifyPaymentDate, hasAnyPermission } from '../permissions';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import { todayLocalIso } from '../utils/date';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const emptySideForm = {
  amountInput: '',
  article_id: '',
  counterparty_id: '',
  comment: '',
};

function prefsKey(branchId) {
  return `cashier:prefs:${branchId || 'main'}`;
}

function loadPrefs(branchId) {
  try {
    return JSON.parse(sessionStorage.getItem(prefsKey(branchId)) || '{}');
  } catch {
    return {};
  }
}

function savePrefs(branchId, patch) {
  const next = { ...loadPrefs(branchId), ...patch };
  sessionStorage.setItem(prefsKey(branchId), JSON.stringify(next));
}

function isIncomeType(type) {
  return type === 'other_income' || type === 'customer_income';
}

function todayIso() {
  return todayLocalIso();
}

function SortHeader({ label, sortKey, activeKey, direction, onSort, className = '' }) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`sortable-th ${className}${active ? ' is-sorted' : ''}`}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="sortable-th-btn"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="sortable-th-icons" aria-hidden="true">
          <span className={`sort-arrow up${active && direction === 'asc' ? ' active' : ''}`}>▲</span>
          <span className={`sort-arrow down${active && direction === 'desc' ? ' active' : ''}`}>▼</span>
        </span>
      </button>
    </th>
  );
}

function comparePayments(a, b, sortKey, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1;
  switch (sortKey) {
    case 'number':
      return dir * ((Number(a.number) || 0) - (Number(b.number) || 0));
    case 'side': {
      const sideA = isIncomeType(a.type) ? 'Приход' : 'Расход';
      const sideB = isIncomeType(b.type) ? 'Приход' : 'Расход';
      return dir * sideA.localeCompare(sideB, 'ru');
    }
    case 'article_name':
      return dir * (a.article_name || '').localeCompare(b.article_name || '', 'ru');
    case 'counterparty_name':
      return dir * (a.counterparty_name || '').localeCompare(b.counterparty_name || '', 'ru');
    case 'comment':
      return dir * (a.comment || '').localeCompare(b.comment || '', 'ru');
    case 'amount':
      return dir * ((a.amount || 0) - (b.amount || 0));
    default:
      return 0;
  }
}

function ArticleChips({ side, articles, value, onChange, disabled }) {
  if (!articles.length) return null;

  return (
    <div className="cashier-article-chips" role="group" aria-label="Статья">
      {articles.map((article) => (
        <button
          key={article.id}
          type="button"
          className={`cashier-article-chip${value === article.id ? ' selected' : ''}`}
          data-side={side}
          disabled={disabled}
          onClick={() => onChange(article.id)}
        >
          {article.name}
        </button>
      ))}
    </div>
  );
}

function CashierSideForm({
  side,
  title,
  articles,
  suppliers = [],
  recentSupplierIds = [],
  form,
  setForm,
  saving,
  canEdit,
  onSubmit,
  amountRef,
  supplierSearchRef,
  purchaseArticleId,
}) {
  const needsSupplier = side === 'expense' && purchaseArticleId && form.article_id === purchaseArticleId;
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showComment, setShowComment] = useState(Boolean(form.comment));

  useEffect(() => {
    if (form.comment) setShowComment(true);
  }, [form.comment]);

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, supplierSearch]);

  const recentSuppliers = useMemo(
    () => recentSupplierIds
      .map((id) => suppliers.find((s) => s.id === id))
      .filter(Boolean),
    [recentSupplierIds, suppliers],
  );

  const showRecentRow = !supplierSearch && recentSuppliers.length > 0 && suppliers.length > 8;
  const useChipList = filteredSuppliers.length > 0 && filteredSuppliers.length <= 8;

  const selectArticle = (article_id) => {
    const next = {
      ...form,
      article_id,
      counterparty_id: article_id === purchaseArticleId ? form.counterparty_id : '',
    };
    setForm(next);

    window.requestAnimationFrame(() => {
      if (article_id === purchaseArticleId && !next.counterparty_id) {
        supplierSearchRef?.current?.focus();
      }
    });
  };

  const selectSupplier = (counterparty_id) => {
    setForm({ ...form, counterparty_id });
  };

  const disabled = !canEdit || saving;

  return (
    <form
      className={`card cashier-panel cashier-panel-${side}`}
      onSubmit={onSubmit}
    >
      <div className="cashier-panel-head">
        <h2>{title}</h2>
        {form.amountInput && form.article_id && (!needsSupplier || form.counterparty_id) && (
          <span className="cashier-panel-ready">готово к проведению</span>
        )}
      </div>

      <label className="cashier-amount-field">
        <span>Сумма *</span>
        <div className="cashier-amount-wrap">
          <input
            ref={amountRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="cashier-amount-input"
            placeholder="0"
            value={form.amountInput}
            onChange={(e) => setForm({ ...form, amountInput: formatPriceInput(e.target.value) })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={disabled}
          />
          <span className="cashier-amount-suffix">сум</span>
        </div>
      </label>

      <div className="cashier-field">
        <span>{side === 'income' ? 'Статья прихода' : 'Статья расхода'} *</span>
        <ArticleChips
          side={side}
          articles={articles}
          value={form.article_id}
          onChange={selectArticle}
          disabled={disabled}
        />
        <select
          className="cashier-article-select"
          value={form.article_id}
          onChange={(e) => selectArticle(e.target.value)}
          disabled={disabled}
          required
          aria-label={side === 'income' ? 'Статья прихода' : 'Статья расхода'}
        >
          <option value="">— выберите —</option>
          {articles.map((article) => (
            <option key={article.id} value={article.id}>{article.name}</option>
          ))}
        </select>
      </div>

      {needsSupplier && (
        <div className="cashier-field cashier-field-supplier">
          <span>Поставщик *</span>
          {showRecentRow && (
            <div className="cashier-supplier-chips cashier-supplier-recent">
              <span className="cashier-supplier-recent-label">Недавние:</span>
              {recentSuppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  className={`cashier-supplier-chip${form.counterparty_id === supplier.id ? ' selected' : ''}`}
                  disabled={disabled}
                  onClick={() => selectSupplier(supplier.id)}
                >
                  {supplier.name}
                </button>
              ))}
            </div>
          )}
          <input
            ref={supplierSearchRef}
            type="search"
            className="cashier-supplier-search"
            placeholder="Найти поставщика…"
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            disabled={disabled}
          />
          {useChipList ? (
            <div className="cashier-supplier-chips">
              {filteredSuppliers.map((supplier) => (
                <button
                  key={supplier.id}
                  type="button"
                  className={`cashier-supplier-chip${form.counterparty_id === supplier.id ? ' selected' : ''}`}
                  disabled={disabled}
                  onClick={() => selectSupplier(supplier.id)}
                >
                  {supplier.name}
                </button>
              ))}
            </div>
          ) : (
            <select
              value={form.counterparty_id}
              onChange={(e) => selectSupplier(e.target.value)}
              disabled={disabled}
              required
            >
              <option value="">— выберите —</option>
              {filteredSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          )}
          {filteredSuppliers.length === 0 && (
            <span className="cashier-field-hint">Поставщики не найдены</span>
          )}
        </div>
      )}

      <div className="cashier-comment-block">
        {!showComment ? (
          <button
            type="button"
            className="cashier-comment-toggle"
            disabled={disabled}
            onClick={() => setShowComment(true)}
          >
            + Комментарий
          </button>
        ) : (
          <label className="cashier-field full">
            <span>Комментарий</span>
            <input
              type="text"
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              placeholder="Необязательно"
              disabled={disabled}
            />
          </label>
        )}
      </div>

      <div className="cashier-form-actions">
        <button
          type="submit"
          className={`btn btn-primary cashier-submit btn-${side}`}
          disabled={disabled || !form.article_id || (needsSupplier && !form.counterparty_id)}
        >
          {saving ? 'Сохранение…' : (side === 'income' ? 'Провести приход' : 'Провести расход')}
        </button>
      </div>
    </form>
  );
}

function paymentSide(payment) {
  return isIncomeType(payment.type) ? 'income' : 'expense';
}

function buildPaymentPayload(side, form, purchaseArticleId) {
  const amount = parsePriceInput(form.amountInput);
  const isPurchase = side === 'expense' && purchaseArticleId && form.article_id === purchaseArticleId;
  return {
    type: side === 'income'
      ? 'other_income'
      : (isPurchase ? 'supplier_payment' : 'other_expense'),
    amount,
    date: form.date,
    article_id: form.article_id,
    counterparty_id: isPurchase ? form.counterparty_id : null,
    comment: form.comment.trim(),
  };
}

function CashierEditModal({
  payment,
  incomeArticles,
  expenseArticles,
  suppliers,
  canEditPast,
  onClose,
  onSave,
  purchaseArticleId,
}) {
  const side = paymentSide(payment);
  const articles = side === 'income' ? incomeArticles : expenseArticles;
  const [form, setForm] = useState({
    amountInput: formatPriceInput(String(payment.amount || '')),
    article_id: payment.article_id || '',
    counterparty_id: payment.counterparty_id || '',
    comment: payment.comment || '',
    date: payment.date,
  });
  const needsSupplier = side === 'expense' && purchaseArticleId && form.article_id === purchaseArticleId;

  const save = () => {
    const amount = parsePriceInput(form.amountInput);
    if (!amount || amount <= 0) return { error: 'Укажите сумму больше нуля' };
    if (!form.article_id) return { error: 'Выберите статью' };
    if (needsSupplier && !form.counterparty_id) return { error: 'Выберите поставщика' };
    return { payload: buildPaymentPayload(side, form, purchaseArticleId) };
  };

  return (
    <Modal
      title={`Редактировать операцию №${payment.number}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const result = save();
              if (result.error) {
                onSave(null, result.error);
                return;
              }
              onSave(result.payload);
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="form-grid cashier-edit-grid">
        {canEditPast && (
          <div className="form-group">
            <label>Дата</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
        )}
        <div className="form-group full">
          <label>{side === 'income' ? 'Статья прихода' : 'Статья расхода'} *</label>
          <ArticleChips
            side={side}
            articles={articles}
            value={form.article_id}
            onChange={(article_id) => setForm({
              ...form,
              article_id,
              counterparty_id: article_id === purchaseArticleId ? form.counterparty_id : '',
            })}
            disabled={false}
          />
          <select
            className="cashier-article-select cashier-article-select-visible"
            value={form.article_id}
            onChange={(e) => setForm({
              ...form,
              article_id: e.target.value,
              counterparty_id: e.target.value === purchaseArticleId ? form.counterparty_id : '',
            })}
          >
            <option value="">— выберите —</option>
            {articles.map((article) => (
              <option key={article.id} value={article.id}>{article.name}</option>
            ))}
          </select>
        </div>
        {needsSupplier && (
          <div className="form-group full">
            <label>Поставщик *</label>
            <select
              value={form.counterparty_id}
              onChange={(e) => setForm({ ...form, counterparty_id: e.target.value })}
            >
              <option value="">— выберите —</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-group">
          <label>Сумма *</label>
          <input
            type="text"
            inputMode="numeric"
            value={form.amountInput}
            onChange={(e) => setForm({ ...form, amountInput: formatPriceInput(e.target.value) })}
          />
        </div>
        <div className="form-group full">
          <label>Комментарий</label>
          <input
            type="text"
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
            placeholder="Необязательно"
          />
        </div>
      </div>
    </Modal>
  );
}

export default function Cashier() {
  const [payments, setPayments] = useState([]);
  const [paymentsLoadError, setPaymentsLoadError] = useState('');
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [incomeArticles, setIncomeArticles] = useState([]);
  const [expenseArticles, setExpenseArticles] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [shiftDate, setShiftDate] = useState(todayIso());
  const [incomeForm, setIncomeForm] = useState(emptySideForm);
  const [expenseForm, setExpenseForm] = useState(emptySideForm);
  const [savingSide, setSavingSide] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [sortKey, setSortKey] = useState('number');
  const [sortDir, setSortDir] = useState('desc');
  const incomeAmountRef = useRef(null);
  const expenseAmountRef = useRef(null);
  const expenseSupplierSearchRef = useRef(null);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchName, branchId } = useBranch();
  const canEdit = hasAnyPermission(user, ['cashier.edit', 'payments.edit']);
  const canDelete = hasAnyPermission(user, ['cashier.delete', 'payments.delete']);
  const canEditPast = hasAnyPermission(user, ['cashier.edit_past', 'payments.edit_past']);
  const canWriteShift = canEdit && (shiftDate === todayIso() || canEditPast);

  const applySavedPrefs = useCallback(() => {
    const prefs = loadPrefs(branchId);
    setIncomeForm((prev) => ({
      ...prev,
      article_id: prefs.incomeArticle || prev.article_id,
    }));
    setExpenseForm((prev) => ({
      ...prev,
      article_id: prefs.expenseArticle || prev.article_id,
      counterparty_id: prefs.supplierId || prev.counterparty_id,
    }));
  }, [branchId]);

  const loadPayments = useCallback(async (options = {}) => {
    const { silent = false } = options;
    if (!silent) {
      setPaymentsLoaded(false);
    }
    try {
      const p = await api.getPayments();
      setPayments(p);
      setPaymentsLoadError('');
      setPaymentsLoaded(true);
      return p;
    } catch (err) {
      if (!silent) {
        setPayments([]);
        setPaymentsLoadError(err.message || 'Не удалось загрузить операции');
      }
      setPaymentsLoaded(true);
      throw err;
    }
  }, [branchId]);

  const load = useCallback(async (options = {}) => {
    const { silent = false } = options;
    loadPayments({ silent }).catch((err) => {
      if (!silent) console.error(err);
    });

    try {
      const [income, expense] = await Promise.all([
        api.getCashArticles({ direction: 'income' }),
        api.getCashArticles({ direction: 'expense' }),
      ]);
      setIncomeArticles(income);
      setExpenseArticles(expense);
    } catch (err) {
      console.error(err);
      if (!silent) show(err.message || 'Не удалось загрузить статьи кассы', 'error');
    }

    try {
      const supplierList = await api.getCounterparties('supplier');
      setSuppliers(supplierList);
    } catch (err) {
      console.error(err);
      setSuppliers([]);
    }
  }, [branchId, loadPayments, show]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(() => load({ silent: true }), [load, branchId], { enabled: !editingPayment });

  useEffect(() => {
    applySavedPrefs();
  }, [applySavedPrefs]);

  useEffect(() => {
    if (canEdit) incomeAmountRef.current?.focus();
  }, [canEdit, branchId]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '1') {
        e.preventDefault();
        incomeAmountRef.current?.focus();
      }
      if (e.key === '2') {
        e.preventDefault();
        expenseAmountRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const purchaseArticleId = useMemo(
    () => expenseArticles.find((a) => a.code === 'exp_purchase')?.id ?? null,
    [expenseArticles],
  );

  const todayPayments = useMemo(
    () => payments.filter((p) => p.date === shiftDate),
    [payments, shiftDate],
  );

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(['number', 'amount'].includes(key) ? 'desc' : 'asc');
  };

  const sortedPayments = useMemo(() => {
    const list = [...todayPayments];
    list.sort((a, b) => comparePayments(a, b, sortKey, sortDir));
    return list;
  }, [todayPayments, sortKey, sortDir]);

  const recentSupplierIds = useMemo(() => {
    const prefs = loadPrefs(branchId);
    const fromToday = [];
    for (const p of payments) {
      if (p.counterparty_id && p.type === 'supplier_payment' && !fromToday.includes(p.counterparty_id)) {
        fromToday.push(p.counterparty_id);
      }
    }
    const fromPrefs = Array.isArray(prefs.recentSuppliers) ? prefs.recentSuppliers : [];
    return [...new Set([...fromToday, ...fromPrefs])].slice(0, 5);
  }, [payments, branchId]);

  const todayIncome = useMemo(
    () => todayPayments.filter((p) => isIncomeType(p.type)).reduce((s, p) => s + (p.amount || 0), 0),
    [todayPayments],
  );

  const todayExpense = useMemo(
    () => todayPayments.filter((p) => !isIncomeType(p.type)).reduce((s, p) => s + (p.amount || 0), 0),
    [todayPayments],
  );

  const focusAmount = (side) => {
    window.requestAnimationFrame(() => {
      (side === 'income' ? incomeAmountRef : expenseAmountRef).current?.focus();
    });
  };

  const resetSideForm = (side, prev) => ({
    ...emptySideForm,
    article_id: prev.article_id,
    counterparty_id: prev.counterparty_id,
  });

  const rememberPrefs = (side, form) => {
    if (side === 'income') {
      savePrefs(branchId, { incomeArticle: form.article_id });
      return;
    }
    const patch = { expenseArticle: form.article_id };
    if (form.counterparty_id) {
      patch.supplierId = form.counterparty_id;
      const prev = loadPrefs(branchId).recentSuppliers || [];
      patch.recentSuppliers = [form.counterparty_id, ...prev.filter((id) => id !== form.counterparty_id)].slice(0, 5);
    }
    savePrefs(branchId, patch);
  };

  const submitSide = (side) => async (e) => {
    e.preventDefault();
    if (!canWriteShift) return;

    const form = side === 'income' ? incomeForm : expenseForm;
    const setForm = side === 'income' ? setIncomeForm : setExpenseForm;
    const amount = parsePriceInput(form.amountInput);

    if (!amount || amount <= 0) {
      show('Укажите сумму больше нуля', 'error');
      focusAmount(side);
      return;
    }
    if (!form.article_id) {
      show(side === 'income' ? 'Выберите статью прихода' : 'Выберите статью расхода', 'error');
      return;
    }
    const isPurchase = side === 'expense' && purchaseArticleId && form.article_id === purchaseArticleId;
    if (isPurchase && !form.counterparty_id) {
      show('Выберите поставщика', 'error');
      expenseSupplierSearchRef.current?.focus();
      return;
    }

    setSavingSide(side);
    try {
      const created = await api.createPayment({
        type: side === 'income'
          ? 'other_income'
          : (isPurchase ? 'supplier_payment' : 'other_expense'),
        amount,
        date: shiftDate,
        article_id: form.article_id,
        counterparty_id: isPurchase ? form.counterparty_id : undefined,
        comment: form.comment.trim(),
      });
      rememberPrefs(side, form);
      show(side === 'income' ? 'Кассовый приход сохранён' : 'Кассовый расход сохранён');
      setForm(resetSideForm(side, form));
      setPayments((prev) => {
        const exists = prev.some((p) => p.id === created.id);
        if (exists) return prev;
        return [created, ...prev];
      });
      loadPayments().catch(console.error);
      focusAmount(side);
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setSavingSide(null);
    }
  };

  const saveEditedPayment = async (payload, errorMessage) => {
    if (errorMessage) {
      show(errorMessage, 'error');
      return;
    }
    try {
      await api.updatePayment(editingPayment.id, payload);
      show('Операция обновлена');
      setEditingPayment(null);
      load();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const removePayment = async (payment) => {
    if (!canDelete || !canModifyPaymentDate(user, payment.date)) return;
    if (!window.confirm(`Удалить операцию №${payment.number}?`)) return;
    try {
      await api.deletePayment(payment.id);
      show('Операция удалена');
      load();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const isToday = shiftDate === todayIso();
  const otherDatesCount = useMemo(
    () => payments.filter((p) => p.date !== shiftDate).length,
    [payments, shiftDate],
  );
  const latestOtherDate = useMemo(() => {
    const dates = [...new Set(payments.map((p) => p.date).filter((d) => d && d !== shiftDate))];
    dates.sort((a, b) => b.localeCompare(a));
    return dates[0] || null;
  }, [payments, shiftDate]);

  return (
    <div className="cashier-page">
      {Toast}

      <div className="cashier-top">
        <div className="cashier-head">
          <h1>Касса</h1>
          <BranchChip>{branchName}</BranchChip>
          <span className="cashier-hotkeys">Alt+1 приход · Alt+2 расход · Enter — провести</span>
        </div>

        <div className="cashier-top-controls">
          <label className="cashier-date-field">
            <span>Дата смены</span>
            <div className="cashier-date-wrap">
              <input
                type="date"
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
              />
              {!isToday && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm cashier-today-btn"
                  onClick={() => setShiftDate(todayIso())}
                >
                  Сегодня
                </button>
              )}
            </div>
          </label>

          <div className="cashier-kpi-inline">
            <div className="cashier-kpi-pill cashier-kpi-income">
              <span className="label">Приход</span>
              <span className="value">{formatMoney(todayIncome)}</span>
            </div>
            <div className="cashier-kpi-pill cashier-kpi-expense">
              <span className="label">Расход</span>
              <span className="value">{formatMoney(todayExpense)}</span>
            </div>
            <div className="cashier-kpi-pill cashier-kpi-balance">
              <span className="label">Остаток</span>
              <span className="value">{formatMoney(todayIncome - todayExpense)}</span>
            </div>
          </div>
        </div>
      </div>

      {canEdit ? (
        canWriteShift ? (
        <div className="cashier-split">
          <CashierSideForm
            side="income"
            title="Кассовый приход"
            articles={incomeArticles}
            form={incomeForm}
            setForm={setIncomeForm}
            saving={savingSide === 'income'}
            canEdit={canWriteShift}
            onSubmit={submitSide('income')}
            amountRef={incomeAmountRef}
          />
          <CashierSideForm
            side="expense"
            title="Кассовый расход"
            articles={expenseArticles}
            suppliers={suppliers}
            recentSupplierIds={recentSupplierIds}
            form={expenseForm}
            setForm={setExpenseForm}
            saving={savingSide === 'expense'}
            canEdit={canWriteShift}
            onSubmit={submitSide('expense')}
            amountRef={expenseAmountRef}
            supplierSearchRef={expenseSupplierSearchRef}
            purchaseArticleId={purchaseArticleId}
          />
        </div>
        ) : (
          <div className="card cashier-shift-notice">
            <div className="empty">
              Ввод операций за {formatDate(shiftDate)} недоступен. Переключитесь на сегодня или обратитесь к администратору.
            </div>
          </div>
        )
      ) : (
        <div className="card"><div className="empty">Нет прав на ввод кассовых операций</div></div>
      )}

      <div className="card cashier-history">
        <div className="card-header">
          <strong>Операции за {formatDate(shiftDate)}</strong>
          <span className="report-meta">{todayPayments.length} записей</span>
        </div>
        {!canEditPast && !isToday && (
          <p className="cashier-history-hint">Редактирование прошлых дат доступно администратору и бухгалтеру</p>
        )}
        {paymentsLoadError && (
          <p className="cashier-history-hint cashier-history-error">
            {paymentsLoadError}. Проверьте право «Касса → Смотреть» и перезайдите в систему.
            {' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={load}>Повторить</button>
          </p>
        )}
        {!paymentsLoadError && paymentsLoaded && todayPayments.length === 0 && otherDatesCount > 0 && latestOtherDate && (
          <p className="cashier-history-hint">
            На {formatDate(shiftDate)} операций нет, но в филиале есть {otherDatesCount} за другие даты.
            {' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShiftDate(latestOtherDate)}
            >
              Открыть {formatDate(latestOtherDate)}
            </button>
          </p>
        )}
        <div className="table-wrap cashier-table-wrap">
          <table className="cashier-table">
            <colgroup>
              <col className="col-num-short" />
              <col className="col-side" />
              <col className="col-article" />
              <col className="col-counterparty" />
              <col className="col-comment" />
              <col className="col-amount" />
              {(canEdit || canDelete) && <col className="col-actions" />}
            </colgroup>
            <thead>
              <tr>
                <SortHeader
                  label="№"
                  sortKey="number"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Сторона"
                  sortKey="side"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Статья"
                  sortKey="article_name"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Контрагент"
                  sortKey="counterparty_name"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Комментарий"
                  sortKey="comment"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                />
                <SortHeader
                  label="Сумма"
                  sortKey="amount"
                  activeKey={sortKey}
                  direction={sortDir}
                  onSort={handleSort}
                  className="col-num"
                />
                {(canEdit || canDelete) && <th className="col-actions">Действия</th>}
              </tr>
            </thead>
            <tbody>
              {sortedPayments.map((p) => {
                const income = isIncomeType(p.type);
                const canModify = canModifyPaymentDate(user, p.date);
                const isCashOp = ['other_income', 'other_expense', 'supplier_payment'].includes(p.type);
                return (
                  <tr key={p.id} className={income ? 'cashier-row-income' : 'cashier-row-expense'}>
                    <td className="muted">{p.number}</td>
                    <td>
                      <span className={`badge ${income ? 'badge-prihod' : 'badge-rashod'}`}>
                        {income ? 'Приход' : 'Расход'}
                      </span>
                    </td>
                    <td className="cashier-cell-article">{p.article_name || '—'}</td>
                    <td className="muted">{p.counterparty_name || '—'}</td>
                    <td className="muted cashier-cell-comment">{p.comment || '—'}</td>
                    <td className={`col-num strong${income ? ' text-income' : ' text-expense'}`}>
                      {income ? '+' : '−'}{formatMoney(p.amount)}
                    </td>
                    {(canEdit || canDelete) && (
                      <td className="cashier-row-actions">
                        {canEdit && canModify && isCashOp && (
                          <IconButton title="Изменить" onClick={() => setEditingPayment(p)}>
                            <IconEdit />
                          </IconButton>
                        )}
                        {canDelete && canModify && isCashOp && (
                          <IconButton title="Удалить" danger onClick={() => removePayment(p)}>
                            <IconTrash />
                          </IconButton>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {todayPayments.length === 0 && (
                <tr>
                  <td colSpan={(canEdit || canDelete) ? 7 : 6} className="empty">
                    {paymentsLoadError
                      ? 'Операции не загружены'
                      : paymentsLoaded && payments.length === 0
                        ? `В филиале «${branchName}» ещё нет кассовых операций — проведите первую операцию выше или выберите другой филиал в меню`
                        : 'Операций за выбранную дату нет'}
                  </td>
                </tr>
              )}
            </tbody>
            {todayPayments.length > 0 && (
              <tfoot>
                <tr className="report-total-row">
                  <td colSpan={5}>Итого за день</td>
                  <td className="col-num">
                    <span className="text-income">+{formatMoney(todayIncome)}</span>
                    {' / '}
                    <span className="text-expense">−{formatMoney(todayExpense)}</span>
                  </td>
                  {(canEdit || canDelete) && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {editingPayment && (
        <CashierEditModal
          payment={editingPayment}
          incomeArticles={incomeArticles}
          expenseArticles={expenseArticles}
          suppliers={suppliers}
          canEditPast={canEditPast}
          onClose={() => setEditingPayment(null)}
          onSave={saveEditedPayment}
          purchaseArticleId={purchaseArticleId}
        />
      )}
    </div>
  );
}
