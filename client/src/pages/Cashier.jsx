import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatMoney, formatPriceInput, parsePriceInput } from '../api';
import Modal, { useToast } from '../components/Modal';
import { IconButton, IconEdit, IconTrash } from '../components/ActionIcons';
import { canModifyPaymentDate, canWriteCashierShift, getCashierViewMinDate, hasAnyPermission, isCashierOnlyLayout } from '../permissions';
import { useAuth } from '../AuthContext';
import { useTheme } from '../ThemeContext';
import { useBranch } from '../BranchContext';
import { IconNavCashier, IconNavMoon, IconNavSun } from '../components/NavIcons';
import BranchChip from '../components/BranchChip';
import { todayLocalIso } from '../utils/date';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { textMatchesSearch } from '../utils/searchNormalize';
import CounterpartySearchSelect from '../components/CounterpartySearchSelect';

const emptySideForm = {
  amountInput: '',
  article_id: '',
  counterparty_id: '',
  comment: '',
};

const RECONCILE_ARTICLE_CODES = new Set(['inc_surplus', 'exp_shortage']);
const CASH_OP_TYPES = new Set(['other_income', 'other_expense', 'supplier_payment', 'customer_income']);

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

function everydayArticles(articles) {
  return articles.filter((article) => !RECONCILE_ARTICLE_CODES.has(article.code));
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

function recentCounterparties(payments, items, limit = 5) {
  if (!items.length) return [];
  const allowed = new Set(items.map((item) => item.id));
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set();
  const result = [];
  for (const payment of payments) {
    const id = payment.counterparty_id;
    if (!id || seen.has(id) || !allowed.has(id)) continue;
    seen.add(id);
    result.push(byId.get(id));
    if (result.length >= limit) break;
  }
  return result;
}

function sortArticlesByUse(articles, payments) {
  if (!articles.length) return articles;
  const counts = new Map();
  for (const payment of payments) {
    if (!payment.article_id) continue;
    counts.set(payment.article_id, (counts.get(payment.article_id) || 0) + 1);
  }
  return [...articles].sort((a, b) => {
    const diff = (counts.get(b.id) || 0) - (counts.get(a.id) || 0);
    if (diff) return diff;
    return (a.sort_order || 0) - (b.sort_order || 0);
  });
}

function CashierEntry({
  side,
  onSideChange,
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
  recentItems,
  lastPayment,
  onRepeatLast,
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
      } else {
        amountRef?.current?.focus();
      }
    });
  };

  const disabled = !canEdit || saving;
  const ready = Boolean(form.amountInput && form.article_id && (!counterpartyKind || form.counterparty_id));

  return (
    <form
      className={`card cashier-panel cashier-entry cashier-panel-${side}`}
      onSubmit={onSubmit}
    >
      <div className="cashier-side-toggle" role="tablist" aria-label="Сторона кассы">
        <button
          type="button"
          role="tab"
          aria-selected={side === 'income'}
          className={`cashier-side-btn${side === 'income' ? ' is-active' : ''}`}
          data-side="income"
          disabled={disabled}
          onClick={() => onSideChange('income')}
        >
          Приход
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={side === 'expense'}
          className={`cashier-side-btn${side === 'expense' ? ' is-active' : ''}`}
          data-side="expense"
          disabled={disabled}
          onClick={() => onSideChange('expense')}
        >
          Расход
        </button>
      </div>

      <label className="cashier-amount-field">
        <span>Сумма *</span>
        <div className="cashier-amount-wrap">
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
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
        <span>Статья *</span>
        <ArticleChips
          side={side}
          articles={articles}
          value={form.article_id}
          onChange={selectArticle}
          disabled={disabled}
        />
      </div>

      {counterpartyKind && (
        <div className="cashier-field cashier-field-supplier">
          <span>{counterpartyKind === 'supplier' ? 'Поставщик' : 'Клиент'} *</span>
          {recentItems.length > 0 && (
            <div className="cashier-supplier-chips cashier-supplier-recent">
              {recentItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`cashier-supplier-chip${form.counterparty_id === item.id ? ' selected' : ''}`}
                  disabled={disabled}
                  onClick={() => {
                    setForm({ ...form, counterparty_id: item.id });
                    amountRef?.current?.focus();
                  }}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}
          <CounterpartySearchSelect
            items={counterpartyItems}
            value={form.counterparty_id}
            onChange={(counterparty_id) => {
              setForm({ ...form, counterparty_id });
              amountRef?.current?.focus();
            }}
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
        {lastPayment && (
          <button
            type="button"
            className="btn btn-ghost btn-sm cashier-repeat-btn"
            disabled={disabled}
            onClick={onRepeatLast}
          >
            Повторить последнюю
          </button>
        )}
        <button
          type="submit"
          className={`btn btn-primary cashier-submit btn-${side}`}
          disabled={disabled || !form.article_id || (counterpartyKind && !form.counterparty_id)}
        >
          {saving
            ? 'Сохранение…'
            : (side === 'income' ? 'Провести приход' : 'Провести расход')}
        </button>
        {ready && <span className="cashier-form-hint">Enter — провести</span>}
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
            inputMode="decimal"
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
            inputMode="decimal"
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

function PaymentActions({ payment, canEdit, canDelete, canModify, onEdit, onRemove }) {
  const isCashOp = CASH_OP_TYPES.has(payment.type);
  if (!(canModify && isCashOp)) return null;
  return (
    <>
      {canEdit && (
        <IconButton title="Изменить" onClick={() => onEdit(payment)}>
          <IconEdit />
        </IconButton>
      )}
      {canDelete && (
        <IconButton title="Удалить" danger onClick={() => onRemove(payment)}>
          <IconTrash />
        </IconButton>
      )}
    </>
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
  const [activeSide, setActiveSide] = useState('income');
  const [incomeForm, setIncomeForm] = useState(emptySideForm);
  const [expenseForm, setExpenseForm] = useState(emptySideForm);
  const [savingSide, setSavingSide] = useState(null);
  const [editingPayment, setEditingPayment] = useState(null);
  const [sortKey, setSortKey] = useState('number');
  const [sortDir, setSortDir] = useState('desc');
  const [listQuery, setListQuery] = useState('');
  const [listSide, setListSide] = useState('all');
  const incomeAmountRef = useRef(null);
  const expenseAmountRef = useRef(null);
  const incomeCounterpartySearchRef = useRef(null);
  const expenseSupplierSearchRef = useRef(null);
  const { show, Toast } = useToast();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { branchName, branchId } = useBranch();
  const cashierOnly = isCashierOnlyLayout(user);
  const canEdit = hasAnyPermission(user, ['cashier.edit', 'payments.edit']);
  const canDelete = hasAnyPermission(user, ['cashier.delete', 'payments.delete']);
  const canEditPast = hasAnyPermission(user, ['cashier.edit_past', 'payments.edit_past']);
  const canWriteShift = canWriteCashierShift(user, shiftDate);
  const minShiftDate = canEditPast ? undefined : getCashierViewMinDate();
  const maxShiftDate = todayIso();
  const activeForm = activeSide === 'income' ? incomeForm : expenseForm;
  const setActiveForm = activeSide === 'income' ? setIncomeForm : setExpenseForm;
  const activeAmountRef = activeSide === 'income' ? incomeAmountRef : expenseAmountRef;
  const activeCounterpartyRef = activeSide === 'income' ? incomeCounterpartySearchRef : expenseSupplierSearchRef;

  const handleShiftDateChange = (value) => {
    if (!value) return;
    let next = value;
    if (!canEditPast && minShiftDate && next < minShiftDate) next = minShiftDate;
    if (next > maxShiftDate) next = maxShiftDate;
    setShiftDate(next);
  };

  const applySavedPrefs = useCallback(() => {
    const prefs = loadPrefs(branchId);
    if (prefs.activeSide === 'income' || prefs.activeSide === 'expense') {
      setActiveSide(prefs.activeSide);
    }
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
      const p = await api.getPayments({
        date_from: minShiftDate || undefined,
        date_to: maxShiftDate,
      });
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
  }, [branchId, minShiftDate, maxShiftDate]);

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

  const switchSide = useCallback((side) => {
    setActiveSide(side);
    savePrefs(branchId, { activeSide: side });
  }, [branchId]);

  useEffect(() => {
    if (!canEdit) return;
    (activeSide === 'income' ? incomeAmountRef : expenseAmountRef).current?.focus();
  }, [canEdit, branchId, activeSide]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '1') {
        e.preventDefault();
        switchSide('income');
      }
      if (e.key === '2') {
        e.preventDefault();
        switchSide('expense');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [switchSide]);

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

  const cashPayments = useMemo(
    () => payments.filter((p) => !p.bank_account_id),
    [payments],
  );

  const todayPayments = useMemo(
    () => cashPayments.filter((p) => p.date === shiftDate),
    [cashPayments, shiftDate],
  );
  const otherDatesCount = useMemo(
    () => cashPayments.filter((p) => p.date !== shiftDate).length,
    [cashPayments, shiftDate],
  );
  const latestOtherDate = useMemo(() => {
    const dates = [...new Set(cashPayments.map((p) => p.date).filter((d) => d && d !== shiftDate))];
    dates.sort((a, b) => b.localeCompare(a));
    return dates[0] || null;
  }, [cashPayments, shiftDate]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(['number', 'amount'].includes(key) ? 'desc' : 'asc');
  };

  const filteredPayments = useMemo(() => {
    let list = todayPayments;
    if (listSide === 'income') list = list.filter((p) => isIncomeType(p.type));
    if (listSide === 'expense') list = list.filter((p) => !isIncomeType(p.type));
    const q = listQuery.trim();
    if (q) {
      list = list.filter((p) => (
        textMatchesSearch(String(p.number || ''), q)
        || textMatchesSearch(p.article_name || '', q)
        || textMatchesSearch(p.counterparty_name || '', q)
        || textMatchesSearch(p.comment || '', q)
        || textMatchesSearch(String(p.amount || ''), q)
      ));
    }
    return list;
  }, [todayPayments, listSide, listQuery]);

  const sortedPayments = useMemo(() => {
    const list = [...filteredPayments];
    list.sort((a, b) => comparePayments(a, b, sortKey, sortDir));
    return list;
  }, [filteredPayments, sortKey, sortDir]);

  const incomeArticlesForEntry = useMemo(
    () => sortArticlesByUse(everydayArticles(incomeArticles), todayPayments),
    [incomeArticles, todayPayments],
  );

  const expenseArticlesForEntry = useMemo(
    () => sortArticlesByUse(everydayArticles(expenseArticles), todayPayments),
    [expenseArticles, todayPayments],
  );

  const recentForActive = useMemo(() => {
    const kind = counterpartyKindForArticle(activeForm.article_id, {
      purchaseArticleId,
      clientDebtArticleId,
      debtReturnArticleId,
    });
    if (!kind) return [];
    const items = kind === 'supplier' ? suppliers : clients;
    return recentCounterparties(todayPayments, items);
  }, [
    activeForm.article_id,
    purchaseArticleId,
    clientDebtArticleId,
    debtReturnArticleId,
    suppliers,
    clients,
    todayPayments,
  ]);

  const lastPaymentForSide = useMemo(
    () => todayPayments.find((p) => paymentSide(p) === activeSide) || null,
    [todayPayments, activeSide],
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
      const patch = { incomeArticle: form.article_id, activeSide: side };
      if (form.counterparty_id && debtReturnArticleId && form.article_id === debtReturnArticleId) {
        patch.counterpartyId = form.counterparty_id;
        patch.clientId = form.counterparty_id;
      }
      savePrefs(branchId, patch);
      return;
    }
    const patch = { expenseArticle: form.article_id, activeSide: side };
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

  const repeatLast = () => {
    if (!lastPaymentForSide) return;
    const payment = lastPaymentForSide;
    setActiveForm({
      amountInput: formatPriceInput(String(payment.amount || '')),
      article_id: payment.article_id || '',
      counterparty_id: payment.counterparty_id || '',
      comment: payment.comment || '',
    });
    focusAmount(activeSide);
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

  const shiftToolbar = (
    <>
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
          <span className="label">В кассе</span>
          <span className="value">{formatMoney(shiftSummary.closing_balance)}</span>
        </div>
        {canWriteShift && (
          <button
            type="button"
            className="btn btn-ghost btn-sm cashier-reconcile-btn"
            onClick={() => setReconcileOpen(true)}
          >
            Сверка
          </button>
        )}
      </div>
    </>
  );

  const historyCard = (
    <div className="card cashier-history">
      <div className="card-header cashier-history-header">
        <div className="cashier-history-title">
          <strong>Операции за {formatDate(shiftDate)}</strong>
          <span className="report-meta">{todayPayments.length} записей</span>
        </div>
        <div className="cashier-history-tools">
          <input
            type="search"
            className="cashier-history-search"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="Поиск…"
            aria-label="Поиск по операциям"
          />
          <div className="cashier-list-side" role="group" aria-label="Фильтр стороны">
            <button
              type="button"
              className={listSide === 'all' ? 'is-active' : ''}
              onClick={() => setListSide('all')}
            >
              Все
            </button>
            <button
              type="button"
              className={listSide === 'income' ? 'is-active' : ''}
              onClick={() => setListSide('income')}
            >
              Приход
            </button>
            <button
              type="button"
              className={listSide === 'expense' ? 'is-active' : ''}
              onClick={() => setListSide('expense')}
            >
              Расход
            </button>
          </div>
        </div>
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

      <ul className="cashier-ops-cards">
        {sortedPayments.map((p) => {
          const income = isIncomeType(p.type);
          const canModify = canModifyPaymentDate(user, p.date);
          return (
            <li key={p.id} className={`cashier-op-card${income ? ' is-income' : ' is-expense'}`}>
              <div className="cashier-op-card-top">
                <span className={`badge ${income ? 'badge-prihod' : 'badge-rashod'}`}>
                  {income ? 'Приход' : 'Расход'}
                </span>
                <strong className={income ? 'text-income' : 'text-expense'}>
                  {income ? '+' : '−'}{formatMoney(p.amount)}
                </strong>
              </div>
              <div className="cashier-op-card-meta">
                <span>{p.article_name || '—'}</span>
                {p.counterparty_name && <span>{p.counterparty_name}</span>}
              </div>
              {p.comment ? <div className="cashier-op-card-comment">{p.comment}</div> : null}
              <div className="cashier-op-card-foot">
                <span className="muted">№{p.number}</span>
                <div className="cashier-row-actions">
                  <PaymentActions
                    payment={p}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    canModify={canModify}
                    onEdit={setEditingPayment}
                    onRemove={removePayment}
                  />
                </div>
              </div>
            </li>
          );
        })}
        {sortedPayments.length === 0 && (
          <li className="cashier-op-card cashier-op-card-empty">
            {paymentsLoadError
              ? 'Операции не загружены'
              : paymentsLoaded && cashPayments.length === 0
                ? `В филиале «${branchName}» ещё нет кассовых операций`
                : listQuery || listSide !== 'all'
                  ? 'Ничего не найдено'
                  : 'Операций за выбранную дату нет'}
          </li>
        )}
      </ul>

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
                      <PaymentActions
                        payment={p}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        canModify={canModify}
                        onEdit={setEditingPayment}
                        onRemove={removePayment}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
            {sortedPayments.length === 0 && (
              <tr>
                <td colSpan={(canEdit || canDelete) ? 7 : 6} className="empty">
                  {paymentsLoadError
                    ? 'Операции не загружены'
                    : paymentsLoaded && cashPayments.length === 0
                      ? `В филиале «${branchName}» ещё нет кассовых операций — проведите первую операцию или выберите другой филиал`
                      : listQuery || listSide !== 'all'
                        ? 'Ничего не найдено'
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
                  В кассе {formatMoney(shiftSummary.closing_balance)}
                </td>
                {(canEdit || canDelete) && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );

  const entryPanel = canEdit && canWriteShift && (
    <CashierEntry
      side={activeSide}
      onSideChange={switchSide}
      articles={activeSide === 'income' ? incomeArticlesForEntry : expenseArticlesForEntry}
      suppliers={suppliers}
      clients={clients}
      form={activeForm}
      setForm={setActiveForm}
      saving={savingSide === activeSide}
      canEdit={canWriteShift}
      onSubmit={submitSide(activeSide)}
      amountRef={activeAmountRef}
      counterpartySearchRef={activeCounterpartyRef}
      purchaseArticleId={purchaseArticleId}
      clientDebtArticleId={clientDebtArticleId}
      debtReturnArticleId={debtReturnArticleId}
      recentItems={recentForActive}
      lastPayment={lastPaymentForSide}
      onRepeatLast={repeatLast}
    />
  );

  return (
    <div className="cashier-page">
      {Toast}

      {cashierOnly ? (
        <>
          <header className="cashier-unified-bar">
            <div className="cashier-app-bar-brand">
              <span className="cashier-app-bar-icon" aria-hidden><IconNavCashier /></span>
              <div>
                <strong>Касса</strong>
                {branchName && <span>{branchName}</span>}
              </div>
            </div>
            <div className="cashier-unified-bar-center">
              {shiftToolbar}
            </div>
            <div className="cashier-app-bar-actions">
              <button
                type="button"
                className="theme-toggle"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
                aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              >
                {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
                Выйти
              </button>
            </div>
          </header>
        </>
      ) : (
        <div className="cashier-top">
          <div className="cashier-head">
            <h1>Касса</h1>
            <BranchChip>{branchName}</BranchChip>
            <span className="cashier-hotkeys">Alt+1 приход · Alt+2 расход · Enter — провести</span>
          </div>
          <div className="cashier-top-controls">
            {shiftToolbar}
          </div>
        </div>
      )}

      {canEdit && !canWriteShift && (
        <div className="card cashier-shift-notice">
          <div className="empty">
            Ввод операций за {formatDate(shiftDate)} недоступен. Кассир может проводить операции только за сегодня.
          </div>
        </div>
      )}

      {!canEdit && (
        <div className="card"><div className="empty">Нет прав на ввод кассовых операций</div></div>
      )}

      <div className={`cashier-workspace${entryPanel ? '' : ' is-journal-only'}`}>
        {entryPanel}
        {historyCard}
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
