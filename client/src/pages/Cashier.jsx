import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatMoney, formatPriceInput, parsePriceInput } from '../api';
import Modal, { useToast } from '../components/Modal';
import { IconButton, IconEdit, IconTrash } from '../components/ActionIcons';
import { canModifyPaymentDate, canWriteCashierShift, getCashierViewMinDate, hasAnyPermission, isCashierOnlyLayout } from '../permissions';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import { todayLocalIso } from '../utils/date';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import CounterpartySearchSelect from '../components/CounterpartySearchSelect';

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

function counterpartyKindForArticle(articleId, { purchaseArticleId, clientDebtArticleId, debtReturnArticleId }) {
  if (articleId === purchaseArticleId) return 'supplier';
  if (articleId === clientDebtArticleId || articleId === debtReturnArticleId) return 'client';
  return null;
}

function CashierSideForm({
  side,
  title,
  articles,
  suppliers = [],
  clients = [],
  form,
  setForm,
  saving,
  canEdit,
  onSubmit,
  amountRef,
  counterpartySearchRef,
  purchaseArticleId,
  clientDebtArticleId,
  debtReturnArticleId,
}) {
  const counterpartyKind = counterpartyKindForArticle(form.article_id, {
    purchaseArticleId,
    clientDebtArticleId,
    debtReturnArticleId,
  });
  const counterpartyItems = counterpartyKind === 'supplier' ? suppliers : clients;
  const [showComment, setShowComment] = useState(Boolean(form.comment));

  useEffect(() => {
    if (form.comment) setShowComment(true);
  }, [form.comment]);

  const selectArticle = (article_id) => {
    const articleCtx = { purchaseArticleId, clientDebtArticleId, debtReturnArticleId };
    const prevKind = counterpartyKindForArticle(form.article_id, articleCtx);
    const nextKind = counterpartyKindForArticle(article_id, articleCtx);
    const next = {
      ...form,
      article_id,
      counterparty_id: nextKind && nextKind === prevKind ? form.counterparty_id : '',
    };
    setForm(next);

    window.requestAnimationFrame(() => {
      if (nextKind && !next.counterparty_id) {
        counterpartySearchRef?.current?.focus();
      }
    });
  };

  const disabled = !canEdit || saving;

  return (
    <form
      className={`card cashier-panel cashier-panel-${side}`}
      onSubmit={onSubmit}
    >
      <div className="cashier-panel-head">
        <h2>{title}</h2>
        {form.amountInput && form.article_id && (!counterpartyKind || form.counterparty_id) && (
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

      {counterpartyKind && (
        <div className="cashier-field cashier-field-supplier">
          <span>{counterpartyKind === 'supplier' ? 'Поставщик' : 'Клиент'} *</span>
          <CounterpartySearchSelect
            items={counterpartyItems}
            value={form.counterparty_id}
            onChange={(counterparty_id) => setForm({ ...form, counterparty_id })}
            disabled={disabled}
            placeholder={counterpartyKind === 'supplier' ? 'Найти поставщика…' : 'Найти клиента…'}
            inputRef={counterpartySearchRef}
          />
          {counterpartyItems.length === 0 && (
            <span className="cashier-field-hint">
              {counterpartyKind === 'supplier' ? 'Поставщики не найдены' : 'Клиенты не найдены'}
            </span>
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
          disabled={disabled || !form.article_id || (counterpartyKind && !form.counterparty_id)}
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

function buildPaymentPayload(side, form, purchaseArticleId, clientDebtArticleId, debtReturnArticleId) {
  const amount = parsePriceInput(form.amountInput);
  const isPurchase = side === 'expense' && purchaseArticleId && form.article_id === purchaseArticleId;
  const isClientDebt = side === 'expense' && clientDebtArticleId && form.article_id === clientDebtArticleId;
  const isDebtReturn = side === 'income' && debtReturnArticleId && form.article_id === debtReturnArticleId;
  return {
    type: side === 'income'
      ? (isDebtReturn ? 'customer_income' : 'other_income')
      : (isPurchase ? 'supplier_payment' : 'other_expense'),
    amount,
    date: form.date,
    article_id: form.article_id,
    counterparty_id: (isPurchase || isClientDebt || isDebtReturn) ? form.counterparty_id : null,
    comment: form.comment.trim(),
  };
}

function CashierEditModal({
  payment,
  incomeArticles,
  expenseArticles,
  suppliers,
  clients,
  canEditPast,
  onClose,
  onSave,
  purchaseArticleId,
  clientDebtArticleId,
  debtReturnArticleId,
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
  const articleCtx = { purchaseArticleId, clientDebtArticleId, debtReturnArticleId };
  const counterpartyKind = counterpartyKindForArticle(form.article_id, articleCtx);
  const counterpartyItems = counterpartyKind === 'supplier' ? suppliers : clients;

  const save = () => {
    const amount = parsePriceInput(form.amountInput);
    if (!amount || amount <= 0) return { error: 'Укажите сумму больше нуля' };
    if (!form.article_id) return { error: 'Выберите статью' };
    if (counterpartyKind === 'supplier' && !form.counterparty_id) return { error: 'Выберите поставщика' };
    if (counterpartyKind === 'client' && !form.counterparty_id) return { error: 'Выберите клиента' };
    return { payload: buildPaymentPayload(side, form, purchaseArticleId, clientDebtArticleId, debtReturnArticleId) };
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
            onChange={(article_id) => {
              const prevKind = counterpartyKindForArticle(form.article_id, articleCtx);
              const nextKind = counterpartyKindForArticle(article_id, articleCtx);
              setForm({
                ...form,
                article_id,
                counterparty_id: nextKind && nextKind === prevKind ? form.counterparty_id : '',
              });
            }}
            disabled={false}
          />
          <select
            className="cashier-article-select cashier-article-select-visible"
            value={form.article_id}
            onChange={(e) => {
              const article_id = e.target.value;
              const prevKind = counterpartyKindForArticle(form.article_id, articleCtx);
              const nextKind = counterpartyKindForArticle(article_id, articleCtx);
              setForm({
                ...form,
                article_id,
                counterparty_id: nextKind && nextKind === prevKind ? form.counterparty_id : '',
              });
            }}
          >
            <option value="">— выберите —</option>
            {articles.map((article) => (
              <option key={article.id} value={article.id}>{article.name}</option>
            ))}
          </select>
        </div>
        {counterpartyKind && (
          <div className="form-group full">
            <label>{counterpartyKind === 'supplier' ? 'Поставщик' : 'Клиент'} *</label>
            <CounterpartySearchSelect
              items={counterpartyItems}
              value={form.counterparty_id}
              onChange={(counterparty_id) => setForm({ ...form, counterparty_id })}
              placeholder={counterpartyKind === 'supplier' ? 'Найти поставщика…' : 'Найти клиента…'}
            />
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

function CashReconciliationModal({
  shiftDate,
  expectedClosing,
  incomeArticles,
  expenseArticles,
  canWrite,
  onClose,
  onPosted,
  showToast,
}) {
  const [countedInput, setCountedInput] = useState('');
  const [saving, setSaving] = useState(false);

  const counted = parsePriceInput(countedInput) || 0;
  const hasCounted = countedInput.trim() !== '' && counted >= 0;
  const diff = hasCounted ? counted - expectedClosing : 0;
  const surplusArticle = incomeArticles.find((a) => a.code === 'inc_surplus');
  const shortageArticle = expenseArticles.find((a) => a.code === 'exp_shortage');
  const comment = `Сверка кассы за ${formatDate(shiftDate)}`;

  const postAdjustment = async (side) => {
    const amount = Math.abs(diff);
    if (amount < 0.005) return;
    const article = side === 'income' ? surplusArticle : shortageArticle;
    if (!article) {
      showToast('Статья не найдена — обновите страницу', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.createPayment({
        type: side === 'income' ? 'other_income' : 'other_expense',
        amount,
        date: shiftDate,
        article_id: article.id,
        comment,
      });
      showToast(side === 'income' ? 'Излишек проведён' : 'Недостача проведена');
      onPosted();
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Сверка кассы"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Отмена</button>
          {hasCounted && diff > 0.005 && canWrite && (
            <button type="button" className="btn btn-income" onClick={() => postAdjustment('income')} disabled={saving || !surplusArticle}>
              Провести излишек
            </button>
          )}
          {hasCounted && diff < -0.005 && canWrite && (
            <button type="button" className="btn btn-expense" onClick={() => postAdjustment('expense')} disabled={saving || !shortageArticle}>
              Провести недостачу
            </button>
          )}
        </>
      )}
    >
      <div className="cashier-reconcile">
        <p className="form-hint">
          Пересчитайте наличные в кассе и введите фактическую сумму. Система сравнит её с остатком по учёту.
        </p>
        <div className="cashier-reconcile-row">
          <span>По учёту на конец дня</span>
          <strong>{formatMoney(expectedClosing)}</strong>
        </div>
        <label className="cashier-reconcile-field">
          <span>Фактически в кассе</span>
          <input
            type="text"
            inputMode="numeric"
            value={countedInput}
            onChange={(e) => setCountedInput(formatPriceInput(e.target.value))}
            placeholder="0"
            autoFocus
          />
        </label>
        {hasCounted && (
          <div className={`cashier-reconcile-diff${diff > 0.005 ? ' surplus' : diff < -0.005 ? ' shortage' : ' match'}`}>
            {Math.abs(diff) < 0.005 && <span>Совпадает с учётом</span>}
            {diff > 0.005 && <span>Излишек: {formatMoney(diff)}</span>}
            {diff < -0.005 && <span>Недостача: {formatMoney(Math.abs(diff))}</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Cashier() {
  const [payments, setPayments] = useState([]);
  const [paymentsLoadError, setPaymentsLoadError] = useState('');
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [shiftSummary, setShiftSummary] = useState({
    opening_balance: 0,
    income: 0,
    expense: 0,
    closing_balance: 0,
  });
  const [incomeArticles, setIncomeArticles] = useState([]);
  const [expenseArticles, setExpenseArticles] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [clients, setClients] = useState([]);
  const [shiftDate, setShiftDate] = useState(todayIso());
  const [incomeForm, setIncomeForm] = useState(emptySideForm);
  const [expenseForm, setExpenseForm] = useState(emptySideForm);
  const [savingSide, setSavingSide] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [sortKey, setSortKey] = useState('number');
  const [sortDir, setSortDir] = useState('desc');
  const incomeAmountRef = useRef(null);
  const expenseAmountRef = useRef(null);
  const incomeCounterpartySearchRef = useRef(null);
  const expenseSupplierSearchRef = useRef(null);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchName, branchId } = useBranch();
  const canEdit = hasAnyPermission(user, ['cashier.edit', 'payments.edit']);
  const canDelete = hasAnyPermission(user, ['cashier.delete', 'payments.delete']);
  const canEditPast = hasAnyPermission(user, ['cashier.edit_past', 'payments.edit_past']);
  const canWriteShift = canWriteCashierShift(user, shiftDate);
  const minShiftDate = canEditPast ? undefined : getCashierViewMinDate();
  const maxShiftDate = todayIso();

  const handleShiftDateChange = (value) => {
    if (!value) return;
    let next = value;
    if (!canEditPast && minShiftDate && next < minShiftDate) next = minShiftDate;
    if (next > maxShiftDate) next = maxShiftDate;
    setShiftDate(next);
  };

  const applySavedPrefs = useCallback(() => {
    const prefs = loadPrefs(branchId);
    setIncomeForm((prev) => ({
      ...prev,
      article_id: prefs.incomeArticle || prev.article_id,
    }));
    setExpenseForm((prev) => ({
      ...prev,
      article_id: prefs.expenseArticle || prev.article_id,
      counterparty_id: prefs.counterpartyId || prefs.supplierId || prefs.clientId || prev.counterparty_id,
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

  const loadShiftSummary = useCallback(async () => {
    try {
      const data = await api.getCashShiftSummary(shiftDate);
      setShiftSummary(data);
    } catch (err) {
      console.error(err);
    }
  }, [shiftDate, branchId]);

  const load = useCallback(async (options = {}) => {
    const { silent = false } = options;
    loadPayments({ silent }).catch((err) => {
      if (!silent) console.error(err);
    });
    loadShiftSummary().catch((err) => {
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
      const [supplierList, clientList] = await Promise.all([
        api.getCounterparties('supplier'),
        api.getCounterparties('client'),
      ]);
      setSuppliers(supplierList);
      setClients(clientList);
    } catch (err) {
      console.error(err);
      setSuppliers([]);
      setClients([]);
    }
  }, [branchId, loadPayments, loadShiftSummary, show]);

  useEffect(() => { load(); }, [load, branchId]);
  useEffect(() => { loadShiftSummary(); }, [loadShiftSummary]);
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

  const clientDebtArticleId = useMemo(
    () => expenseArticles.find((a) => a.code === 'exp_client_debt')?.id ?? null,
    [expenseArticles],
  );

  const debtReturnArticleId = useMemo(
    () => incomeArticles.find((a) => a.code === 'inc_debt_return')?.id ?? null,
    [incomeArticles],
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
      const patch = { incomeArticle: form.article_id };
      if (form.counterparty_id && debtReturnArticleId && form.article_id === debtReturnArticleId) {
        patch.counterpartyId = form.counterparty_id;
        patch.clientId = form.counterparty_id;
      }
      savePrefs(branchId, patch);
      return;
    }
    const patch = { expenseArticle: form.article_id };
    if (form.counterparty_id) {
      patch.counterpartyId = form.counterparty_id;
      const kind = counterpartyKindForArticle(form.article_id, {
        purchaseArticleId,
        clientDebtArticleId,
        debtReturnArticleId,
      });
      if (kind === 'supplier') patch.supplierId = form.counterparty_id;
      if (kind === 'client') patch.clientId = form.counterparty_id;
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
    const isClientDebt = side === 'expense' && clientDebtArticleId && form.article_id === clientDebtArticleId;
    const isDebtReturn = side === 'income' && debtReturnArticleId && form.article_id === debtReturnArticleId;
    if (isPurchase && !form.counterparty_id) {
      show('Выберите поставщика', 'error');
      expenseSupplierSearchRef.current?.focus();
      return;
    }
    if ((isClientDebt || isDebtReturn) && !form.counterparty_id) {
      show('Выберите клиента', 'error');
      (isDebtReturn ? incomeCounterpartySearchRef : expenseSupplierSearchRef).current?.focus();
      return;
    }

    setSavingSide(side);
    try {
      const created = await api.createPayment({
        type: side === 'income'
          ? (isDebtReturn ? 'customer_income' : 'other_income')
          : (isPurchase ? 'supplier_payment' : 'other_expense'),
        amount,
        date: shiftDate,
        article_id: form.article_id,
        counterparty_id: (isPurchase || isClientDebt || isDebtReturn) ? form.counterparty_id : undefined,
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
      load({ silent: true }).catch(console.error);
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
          {!isCashierOnlyLayout(user) && (
            <>
              <h1>Касса</h1>
              <BranchChip>{branchName}</BranchChip>
            </>
          )}
          <span className="cashier-hotkeys">Alt+1 приход · Alt+2 расход · Enter — провести</span>
        </div>

        <div className="cashier-top-controls">
          <label className="cashier-date-field">
            <span>Дата смены</span>
            <div className="cashier-date-wrap">
              <input
                type="date"
                value={shiftDate}
                min={minShiftDate}
                max={maxShiftDate}
                onChange={(e) => handleShiftDateChange(e.target.value)}
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
            <div className="cashier-kpi-pill cashier-kpi-opening">
              <span className="label">На начало</span>
              <span className="value">{formatMoney(shiftSummary.opening_balance)}</span>
            </div>
            <div className="cashier-kpi-pill cashier-kpi-income">
              <span className="label">Приход</span>
              <span className="value">{formatMoney(shiftSummary.income)}</span>
            </div>
            <div className="cashier-kpi-pill cashier-kpi-expense">
              <span className="label">Расход</span>
              <span className="value">{formatMoney(shiftSummary.expense)}</span>
            </div>
            <div className="cashier-kpi-pill cashier-kpi-balance">
              <span className="label">На конец</span>
              <span className="value">{formatMoney(shiftSummary.closing_balance)}</span>
            </div>
            {canWriteShift && (
              <button
                type="button"
                className="btn btn-ghost btn-sm cashier-reconcile-btn"
                onClick={() => setReconcileOpen(true)}
              >
                Сверка кассы
              </button>
            )}
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
            clients={clients}
            form={incomeForm}
            setForm={setIncomeForm}
            saving={savingSide === 'income'}
            canEdit={canWriteShift}
            onSubmit={submitSide('income')}
            amountRef={incomeAmountRef}
            counterpartySearchRef={incomeCounterpartySearchRef}
            debtReturnArticleId={debtReturnArticleId}
          />
          <CashierSideForm
            side="expense"
            title="Кассовый расход"
            articles={expenseArticles}
            suppliers={suppliers}
            clients={clients}
            form={expenseForm}
            setForm={setExpenseForm}
            saving={savingSide === 'expense'}
            canEdit={canWriteShift}
            onSubmit={submitSide('expense')}
            amountRef={expenseAmountRef}
            counterpartySearchRef={expenseSupplierSearchRef}
            purchaseArticleId={purchaseArticleId}
            clientDebtArticleId={clientDebtArticleId}
          />
        </div>
        ) : (
          <div className="card cashier-shift-notice">
            <div className="empty">
              Ввод операций за {formatDate(shiftDate)} недоступен. Кассир может проводить операции только за сегодня.
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
          <p className="cashier-history-hint">
            Просмотр за последние 3 дня. Ввод и редактирование — только за сегодня. Для прошлых дат обратитесь к бухгалтеру или администратору.
          </p>
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
                  <td colSpan={5}>
                    На начало {formatMoney(shiftSummary.opening_balance)}
                    {' · '}
                    приход +{formatMoney(shiftSummary.income)}
                    {' · '}
                    расход −{formatMoney(shiftSummary.expense)}
                  </td>
                  <td className="col-num">
                    На конец {formatMoney(shiftSummary.closing_balance)}
                  </td>
                  {(canEdit || canDelete) && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {reconcileOpen && (
        <CashReconciliationModal
          shiftDate={shiftDate}
          expectedClosing={shiftSummary.closing_balance}
          incomeArticles={incomeArticles}
          expenseArticles={expenseArticles}
          canWrite={canWriteShift}
          onClose={() => setReconcileOpen(false)}
          onPosted={() => load({ silent: true })}
          showToast={show}
        />
      )}

      {editingPayment && (
        <CashierEditModal
          payment={editingPayment}
          incomeArticles={incomeArticles}
          expenseArticles={expenseArticles}
          suppliers={suppliers}
          clients={clients}
          canEditPast={canEditPast}
          onClose={() => setEditingPayment(null)}
          onSave={saveEditedPayment}
          purchaseArticleId={purchaseArticleId}
          clientDebtArticleId={clientDebtArticleId}
          debtReturnArticleId={debtReturnArticleId}
        />
      )}
    </div>
  );
}
