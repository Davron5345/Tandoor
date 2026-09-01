import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  formatDate,
  formatMoney,
  formatPriceInput,
  parsePriceInput,
  normalizeQuantityInput,
  parseQuantityInput,
  STATUS_LABELS,
} from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import { IconButton, IconEdit, IconEye, IconPlus, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import ProductSelect from '../components/ProductSelect';
import ProductCreateModal from '../components/ProductCreateModal';
import { encodeProductPick, resolvePickFromProducts } from '../utils/productVariants';
import { hasPermission } from '../permissions';
import { todayLocalIso } from '../utils/date';
import { textMatchesSearch } from '../utils/searchNormalize';

const INVENTORY_PHONE_MQ = '(max-width: 768px)';

function useInventoryPhoneShell(modalOpen) {
  const listRef = useRef(null);
  const [isPhone, setIsPhone] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia(INVENTORY_PHONE_MQ).matches
  ));

  useEffect(() => {
    const html = document.documentElement;
    const mq = window.matchMedia(INVENTORY_PHONE_MQ);

    const sync = () => {
      const phone = mq.matches;
      setIsPhone(phone);
      if (phone) html.classList.add('inventory-phone-lock');
      else html.classList.remove('inventory-phone-lock');
    };

    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      html.classList.remove('inventory-phone-lock');
      html.classList.remove('inventory-modal-open');
    };
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('inventory-modal-open', Boolean(modalOpen));
    return () => html.classList.remove('inventory-modal-open');
  }, [modalOpen]);

  /* Kill iOS rubber-band only when the pane actually scrolls */
  useEffect(() => {
    const mq = window.matchMedia(INVENTORY_PHONE_MQ);
    let startY = 0;
    let scrollEl = null;

    const resolveScrollEl = () => {
      if (modalOpen) {
        return document.querySelector('.modal-doc.modal-inventory .inv-sheet-scroll')
          || document.querySelector('.modal-doc.modal-inventory .modal-body');
      }
      return listRef.current;
    };

    const onStart = (event) => {
      scrollEl = resolveScrollEl();
      if (!event.touches?.[0]) return;
      startY = event.touches[0].clientY;
    };

    const onMove = (event) => {
      if (!mq.matches || event.touches.length !== 1 || !scrollEl) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      if (scrollHeight <= clientHeight + 1) return;
      const y = event.touches[0].clientY;
      const dy = y - startY;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) {
        event.preventDefault();
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onMove, { passive: false, capture: true });
    return () => {
      document.removeEventListener('touchstart', onStart, { capture: true });
      document.removeEventListener('touchmove', onMove, { capture: true });
    };
  }, [modalOpen]);

  return { listRef, isPhone };
}

function formatQty(n) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(rounded);
}

function emptyForm() {
  return {
    date: todayLocalIso(),
    number: '',
    comment: '',
    to_department_id: '',
    status: 'draft',
    inventory_coverage: 'partial',
    article_id: '',
    liable_kind: 'none',
    liable_user_id: '',
    liable_department_id: '',
    remainder_document: null,
    items: [],
  };
}

function cubeTone(id) {
  const s = String(id || '');
  let hash = 0;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash % 8;
}

function cubeClass(id, selected) {
  return `inv-dept-cube inv-cube-tone-${cubeTone(id)}${selected ? ' is-selected' : ''}`;
}

function liableKindFromDoc(doc) {
  if (doc?.liable_user_id) return 'user';
  if (doc?.liable_department_id) return 'department';
  return 'none';
}

function lineFact(item) {
  const parsed = parseQuantityInput(item.quantity);
  return parsed != null ? parsed : Number(item.quantity) || 0;
}

function lineBook(item) {
  return Number(item.book_qty) || 0;
}

function lineCost(item) {
  return Number(item.unit_cost) || 0;
}

function lineDiff(item) {
  return lineFact(item) - lineBook(item);
}

function lineAmount(item) {
  return Math.abs(lineDiff(item)) * lineCost(item);
}

function needsSurplusCost(item) {
  return lineDiff(item) > 1e-9 && !(lineCost(item) > 0);
}

function productUnit(products, item) {
  const pick = resolvePickFromProducts(products, encodeProductPick(item.product_id, item.variant_id));
  return pick.variant?.unit || pick.product?.unit || item.unit || 'шт';
}

function productName(products, item) {
  if (item.product_name) return item.product_name;
  const pick = resolvePickFromProducts(products, encodeProductPick(item.product_id, item.variant_id));
  if (!pick.product) return '—';
  return pick.variant ? `${pick.product.name} — ${pick.variant.name}` : pick.product.name;
}

function productSearchHaystack(products, item) {
  const pick = resolvePickFromProducts(products, encodeProductPick(item.product_id, item.variant_id));
  const name = productName(products, item);
  const parts = [name];
  if (pick.product?.sku) parts.push(pick.product.sku);
  if (pick.product?.barcode) parts.push(pick.product.barcode);
  if (pick.variant?.sku) parts.push(pick.variant.sku);
  if (pick.variant?.name) parts.push(pick.variant.name);
  return parts.filter(Boolean).join(' ');
}

function InventoryDocCard({ doc, canEdit, canDelete, onOpen, onEdit, onDelete }) {
  const showDelete = canDelete && doc.status !== 'confirmed';
  return (
    <article className="inventory-doc-card">
      <button
        type="button"
        className="inventory-doc-card-main"
        onClick={() => (canEdit ? onEdit(doc) : onOpen(doc.id, true))}
      >
        <div className="inventory-doc-card-top">
          <strong>№{doc.number}</strong>
          <span className={`badge badge-${doc.status}`}>{STATUS_LABELS[doc.status]}</span>
        </div>
        <div className="inventory-doc-card-meta">
          <span className="inventory-doc-card-meta-left">
            {formatDate(doc.date)}
            {doc.to_department_name ? ` · ${doc.to_department_name}` : ''}
            {doc.inventory_coverage === 'full' ? ' · Полная' : ''}
          </span>
          <span className="inventory-doc-card-sum">{formatMoney(doc.total_amount)}</span>
        </div>
        {doc.remainder_document?.number ? (
          <div className="inventory-doc-card-remainder">
            Списание №{doc.remainder_document.number}
            {doc.remainder_document.liable_user_name
              ? ` · ${doc.remainder_document.liable_user_name}`
              : doc.remainder_document.liable_department_name
                ? ` · ${doc.remainder_document.liable_department_name}`
                : ''}
            {' · '}
            {formatMoney(doc.remainder_document.total_amount)}
          </div>
        ) : null}
      </button>
      <div className="inventory-doc-card-actions">
        {canEdit && (
          <IconButton title="Редактировать" onClick={() => onEdit(doc)}>
            <IconEdit />
          </IconButton>
        )}
        <IconButton
          title={doc.status === 'confirmed' ? 'Просмотр' : 'Открыть'}
          onClick={() => onOpen(doc.id, doc.status !== 'draft')}
        >
          <IconEye />
        </IconButton>
        {showDelete && (
          <IconButton title="Удалить" onClick={() => onDelete(doc.id)}>
            <IconTrash />
          </IconButton>
        )}
      </div>
    </article>
  );
}

function InventoryLineCard({
  item, idx, products, readOnly, onFact, onCost, onRemove, compact, showAmount = true,
}) {
  const diff = lineDiff(item);
  const amount = lineAmount(item);
  const unit = productUnit(products, item);
  const diffClass = diff > 1e-9 ? 'inv-diff-pos' : diff < -1e-9 ? 'inv-diff-neg' : '';
  const showCost = !readOnly && needsSurplusCost(item);
  const costField = showCost ? (
    <div className="inventory-line-card-cost">
      <span>Себест. излишка</span>
      <input
        className="input-qty"
        inputMode="decimal"
        value={item.unit_cost_input ?? (item.unit_cost ? formatPriceInput(item.unit_cost) : '')}
        onChange={(e) => onCost(idx, e.target.value)}
        placeholder="0,00"
      />
    </div>
  ) : null;
  if (compact) {
    return (
      <article className={`inventory-line-card inventory-line-card--compact${diffClass ? ' inv-row-discrepancy' : ''}`}>
        <div className="inventory-line-card-head">
          <div>
            <strong>{productName(products, item)}</strong>
          </div>
          {!readOnly && (
            <IconButton title="Убрать" onClick={() => onRemove(idx)}>
              <IconTrash />
            </IconButton>
          )}
        </div>
        <div className={`inventory-line-card-compact-row${showAmount ? '' : ' is-qty-only'}`}>
          <div className="inventory-line-card-compact-meta">
            <span>Учёт</span>
            <b className="inv-book-muted">{formatQty(lineBook(item))}</b>
          </div>
          <div className="inventory-line-card-compact-fact">
            <span>Факт</span>
            {readOnly ? (
              <b>{formatQty(lineFact(item))}</b>
            ) : (
              <input
                className="input-qty"
                inputMode="decimal"
                value={item.quantity ?? ''}
                onChange={(e) => onFact(idx, e.target.value)}
              />
            )}
          </div>
          <div className="inventory-line-card-compact-meta">
            <span>Δ</span>
            <b className={diffClass}>{formatQty(diff)}</b>
          </div>
          {showAmount ? (
            <div className="inventory-line-card-compact-meta">
              <span>Сумма</span>
              <b>{formatMoney(amount)}</b>
            </div>
          ) : (
            <div className="inventory-line-card-compact-meta">
              <span>Ед.</span>
              <b>{unit}</b>
            </div>
          )}
        </div>
        {showAmount && (
          <div className="inventory-line-card-unit-row">Ед. изм.: <b>{unit}</b></div>
        )}
        {costField}
      </article>
    );
  }
  return (
    <article className={`inventory-line-card${diffClass ? ' inv-row-discrepancy' : ''}`}>
      <div className="inventory-line-card-head">
        <div>
          <strong>{productName(products, item)}</strong>
          <span className="inventory-line-card-unit">{unit}</span>
        </div>
        {!readOnly && (
          <IconButton title="Убрать" onClick={() => onRemove(idx)}>
            <IconTrash />
          </IconButton>
        )}
      </div>
      <div className="inventory-line-card-grid">
        <div>
          <span>Учёт</span>
          <b className="inv-book-muted">{formatQty(lineBook(item))}</b>
        </div>
        <div>
          <span>Факт</span>
          {readOnly ? (
            <b>{formatQty(lineFact(item))}</b>
          ) : (
            <input
              className="input-qty"
              inputMode="decimal"
              value={item.quantity ?? ''}
              onChange={(e) => onFact(idx, e.target.value)}
            />
          )}
        </div>
        <div>
          <span>Разница</span>
          <b className={diffClass}>{formatQty(diff)}</b>
        </div>
        {showAmount ? (
          <div>
            <span>Сумма</span>
            <b>{formatMoney(amount)}</b>
          </div>
        ) : (
          <div>
            <span>Ед. изм.</span>
            <b>{unit}</b>
          </div>
        )}
      </div>
      {costField}
    </article>
  );
}

export default function Inventory() {
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const { show, Toast } = useToast();
  const canEdit = hasPermission(user, 'documents.edit') && hasPermission(user, 'documents.inventory');
  const canConfirm = hasPermission(user, 'documents.confirm') && canEdit;
  const canDelete = hasPermission(user, 'documents.delete');
  const canCreateProduct = hasPermission(user, 'products.edit');

  const [docs, setDocs] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [products, setProducts] = useState([]);
  const [productsReady, setProductsReady] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [readOnly, setReadOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);
  const [lineFilter, setLineFilter] = useState('all');
  const [itemSearch, setItemSearch] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [addPick, setAddPick] = useState('');
  const [addingLine, setAddingLine] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState('setup'); // setup | items
  const [invOptions, setInvOptions] = useState({ expense_articles: [], users: [], default_article_id: '' });
  const [showAmount, setShowAmount] = useState(() => {
    try {
      return localStorage.getItem('inventory_show_amount_v1') !== '0';
    } catch {
      return true;
    }
  });
  const [topbarEl, setTopbarEl] = useState(null);
  const { listRef, isPhone } = useInventoryPhoneShell(Boolean(modal));
  const productsBranchRef = useRef(null);

  const toggleShowAmount = () => {
    setShowAmount((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('inventory_show_amount_v1', next ? '1' : '0');
      } catch { /* ignore */ }
      return next;
    });
  };

  useEffect(() => {
    if (!isPhone) {
      setTopbarEl(null);
      return undefined;
    }
    let cancelled = false;
    const find = () => {
      const el = document.querySelector('.main-topbar');
      if (!cancelled && el) setTopbarEl(el);
      return Boolean(el);
    };
    if (find()) return undefined;
    const raf = requestAnimationFrame(() => { find(); });
    const timer = setTimeout(() => { find(); }, 100);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [isPhone]);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { type: 'inventory' };
      if (filterDateFrom) params.date_from = filterDateFrom;
      if (filterDateTo) params.date_to = filterDateTo;
      if (filterStatus) params.status = filterStatus;
      const list = await api.getDocuments(params);
      setDocs(Array.isArray(list) ? list : (list?.items || []));
    } catch (e) {
      show(e.message || 'Ошибка загрузки', 'error');
    } finally {
      setLoading(false);
    }
  }, [show, branchId, filterDateFrom, filterDateTo, filterStatus]);

  const loadDepartments = useCallback(async () => {
    try {
      const depts = await api.getDepartments({ active: '1' });
      setDepartments(Array.isArray(depts) ? depts : []);
    } catch (e) {
      show(e.message || 'Не удалось загрузить отделы', 'error');
    }
  }, [show, branchId]);

  const loadInvOptions = useCallback(async () => {
    try {
      const opts = await api.getInventoryOptions();
      setInvOptions({
        expense_articles: opts?.expense_articles || [],
        users: opts?.users || [],
        default_article_id: opts?.default_article_id || '',
      });
    } catch {
      setInvOptions({ expense_articles: [], users: [], default_article_id: '' });
    }
  }, [branchId]);

  const ensureProducts = useCallback(async () => {
    const branchKey = branchId || 'main';
    if (productsReady && productsBranchRef.current === branchKey) return;
    setProductsLoading(true);
    try {
      const prods = await api.getProducts({ limit: 5000 });
      const list = Array.isArray(prods) ? prods : (prods?.items || []);
      setProducts(list);
      productsBranchRef.current = branchKey;
      setProductsReady(true);
    } catch (e) {
      show(e.message || 'Не удалось загрузить товары', 'error');
    } finally {
      setProductsLoading(false);
    }
  }, [branchId, productsReady, show]);

  useEffect(() => {
    loadDepartments();
    loadInvOptions();
  }, [loadDepartments, loadInvOptions]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    productsBranchRef.current = null;
    setProductsReady(false);
    setProducts([]);
  }, [branchId]);

  const branchDepartments = useMemo(
    () => departments.filter((d) => d.active && d.branch_id === (branchId || 'main')),
    [departments, branchId],
  );

  const selectedDepartment = useMemo(
    () => branchDepartments.find((d) => d.id === form.to_department_id) || null,
    [branchDepartments, form.to_department_id],
  );

  const canGoToItems = Boolean(form.to_department_id && form.date);

  const totals = useMemo(() => {
    let shortage = 0;
    let surplus = 0;
    for (const item of form.items) {
      const diff = lineDiff(item);
      const amount = Math.abs(diff) * lineCost(item);
      if (diff < -1e-9) shortage += amount;
      else if (diff > 1e-9) surplus += amount;
    }
    return { shortage, surplus, net: shortage - surplus };
  }, [form.items]);

  const visibleItems = useMemo(() => {
    let rows = form.items.map((item, idx) => ({ item, idx }));
    if (lineFilter === 'discrepancies') {
      rows = rows.filter(({ item }) => Math.abs(lineDiff(item)) > 1e-9);
    }
    const q = itemSearch.trim();
    if (q) {
      rows = rows.filter(({ item }) => textMatchesSearch(productSearchHaystack(products, item), q));
    }
    return rows;
  }, [form.items, lineFilter, itemSearch, products]);

  const showSurplusCostCol = !readOnly && form.items.some(needsSurplusCost);

  const openCreate = async () => {
    const next = emptyForm();
    if (branchDepartments.length === 1) next.to_department_id = branchDepartments[0].id;
    try {
      const { number } = await api.getNextDocNumber('inventory');
      next.number = number;
    } catch { /* ignore */ }
    setForm(next);
    setLineFilter('all');
    setItemSearch('');
    setCommentOpen(false);
    setAddPick('');
    setSheetTab('setup');
    setReadOnly(false);
    setModal('create');
    ensureProducts();
  };

  const setCoverage = (coverage) => {
    if (readOnly) return;
    setForm((prev) => ({
      ...prev,
      inventory_coverage: coverage,
      article_id: coverage === 'full'
        ? (prev.article_id || invOptions.default_article_id || '')
        : prev.article_id,
    }));
  };

  const setLiableKind = (kind) => {
    if (readOnly) return;
    setForm((prev) => ({
      ...prev,
      liable_kind: kind,
      liable_user_id: kind === 'user' ? prev.liable_user_id : '',
      liable_department_id: kind === 'department'
        ? (prev.liable_department_id || prev.to_department_id || '')
        : '',
    }));
  };

  const selectDepartment = (departmentId) => {
    if (readOnly) return;
    if (departmentId === form.to_department_id) return;
    setForm((prev) => ({
      ...prev,
      to_department_id: departmentId,
      items: prev.to_department_id && prev.to_department_id !== departmentId ? [] : prev.items,
    }));
  };

  const goToItemsTab = () => {
    if (!form.date) {
      show('Укажите дату', 'error');
      return;
    }
    if (!form.to_department_id) {
      show('Выберите отдел', 'error');
      return;
    }
    setSheetTab('items');
    ensureProducts();
  };

  const openDoc = async (id, viewOnly = false, tab = 'items') => {
    try {
      const [doc] = await Promise.all([
        api.getDocument(id),
        ensureProducts(),
      ]);
      setForm({
        id: doc.id,
        date: String(doc.date || '').slice(0, 10),
        number: doc.number || '',
        comment: doc.comment || '',
        to_department_id: doc.to_department_id || '',
        status: doc.status,
        inventory_coverage: doc.inventory_coverage === 'full' ? 'full' : 'partial',
        article_id: doc.article_id || '',
        liable_kind: liableKindFromDoc(doc),
        liable_user_id: doc.liable_user_id || '',
        liable_department_id: doc.liable_department_id || '',
        remainder_document: doc.remainder_document || null,
        items: (doc.items || []).map((i) => ({
          product_id: i.product_id,
          variant_id: i.variant_id || null,
          product_name: i.product_name,
          unit: i.unit,
          book_qty: Number(i.book_qty) || 0,
          quantity: i.quantity,
          unit_cost: Number(i.unit_cost) || Number(i.price) || 0,
        })),
      });
      setLineFilter('all');
      setItemSearch('');
      setCommentOpen(Boolean(doc.comment));
      setAddPick('');
      setSheetTab(tab);
      setReadOnly(viewOnly || doc.status !== 'draft');
      setModal(doc.id);
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const editDoc = async (d) => {
    if (!canEdit) {
      await openDoc(d.id, true);
      return;
    }
    if (d.status === 'confirmed') {
      if (!window.confirm('Документ проведён. Отменить проведение и редактировать?')) return;
      try {
        await api.cancelDocument(d.id);
        show('Проведение отменено — можно править');
        await loadDocs();
      } catch (e) {
        show(e.message, 'error');
        return;
      }
    } else if (d.status === 'cancelled') {
      try {
        await api.cancelDocument(d.id);
        await loadDocs();
      } catch (e) {
        show(e.message, 'error');
        return;
      }
    }
    await openDoc(d.id, false, 'setup');
  };

  const fillFromStock = async () => {
    if (!form.to_department_id) {
      show('Сначала выберите отдел', 'error');
      return;
    }
    setFilling(true);
    try {
      const rows = await api.getInventoryStock(form.to_department_id);
      if (!rows.length) {
        show('В отделе нет позиций с остатком', 'error');
        setForm({ ...form, items: [] });
        return;
      }
      setForm({
        ...form,
        items: rows.map((row) => ({
          product_id: row.product_id,
          variant_id: row.variant_id || null,
          product_name: row.name,
          unit: row.unit,
          book_qty: Number(row.book_qty) || 0,
          quantity: String(row.book_qty ?? 0),
          unit_cost: Number(row.avg_cost) || Number(row.suggest_cost) || 0,
        })),
      });
      setLineFilter('all');
    } catch (e) {
      show(e.message || 'Не удалось заполнить', 'error');
    } finally {
      setFilling(false);
    }
  };

  const addResolvedLine = async (resolved) => {
    if (!resolved?.productId) return false;
    const exists = form.items.some(
      (i) => i.product_id === resolved.productId
        && (i.variant_id || null) === (resolved.variantId || null),
    );
    if (exists) {
      show('Эта позиция уже в документе', 'error');
      setAddPick('');
      return false;
    }
    if (!form.to_department_id) {
      show('Сначала выберите отдел', 'error');
      return false;
    }
    const unit = resolved.variant?.unit || resolved.product?.unit || 'шт';
    const name = resolved.variant
      ? `${resolved.product.name} — ${resolved.variant.name}`
      : (resolved.product?.name || 'Товар');
    setAddPick('');
    setAddingLine(true);
    try {
      const rows = await api.getInventoryStock(form.to_department_id, {
        product_id: resolved.productId,
        variant_id: resolved.variantId || undefined,
      });
      const row = Array.isArray(rows) ? rows[0] : rows;
      const book_qty = Number(row?.book_qty) || 0;
      const liveCost = Number(row?.avg_cost) || Number(row?.suggest_cost) || 0;
      setForm((prev) => {
        const already = prev.items.some(
          (i) => i.product_id === resolved.productId
            && (i.variant_id || null) === (resolved.variantId || null),
        );
        if (already) return prev;
        return {
          ...prev,
          items: [
            ...prev.items,
            {
              product_id: resolved.productId,
              variant_id: resolved.variantId || null,
              product_name: name,
              unit,
              book_qty,
              quantity: String(book_qty),
              unit_cost: liveCost,
            },
          ],
        };
      });
      return true;
    } catch (e) {
      show(e.message || 'Не удалось взять учёт по отделу', 'error');
      return false;
    } finally {
      setAddingLine(false);
    }
  };

  const addLine = async (pickValue) => {
    await addResolvedLine(resolvePickFromProducts(products, pickValue));
  };

  const mergeProductIntoList = (product) => {
    setProducts((prev) => {
      const without = prev.filter((p) => p.id !== product.id);
      return [...without, product].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    });
  };

  const onQuickProductCreated = async (created) => {
    mergeProductIntoList(created);
    setProductModalOpen(false);
    const variants = (created.has_variants ? created.variants : null) || [];
    const active = variants.filter((v) => v.id && !v.archived);
    if (active.length > 1) {
      show('Товар создан. Выберите вариант в списке');
      return;
    }
    const variant = active[0] || null;
    const added = await addResolvedLine({
      product: created,
      productId: created.id,
      variant,
      variantId: variant?.id || null,
    });
    if (added) show('Товар создан и добавлен');
  };

  const updateFact = (idx, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], quantity: normalizeQuantityInput(value) };
    setForm({ ...form, items });
  };

  const updateCost = (idx, value) => {
    const items = [...form.items];
    items[idx] = {
      ...items[idx],
      unit_cost_input: formatPriceInput(value),
      unit_cost: parsePriceInput(value) ?? 0,
    };
    setForm({ ...form, items });
  };

  const removeItem = (idx) => {
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  };

  const payloadItems = () => form.items
    .filter((i) => i.product_id)
    .map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id || null,
      quantity: lineFact(i),
      book_qty: lineBook(i),
      unit_cost: lineCost(i),
      price: lineCost(i),
    }));

  const save = async (andConfirm = false) => {
    if (!form.to_department_id) {
      show('Выберите отдел', 'error');
      return;
    }
    if (andConfirm && form.inventory_coverage === 'full') {
      if (!form.article_id) {
        show('Для полной инвентаризации выберите статью списания', 'error');
        return;
      }
      if (form.liable_kind === 'user' && !form.liable_user_id) {
        show('Выберите сотрудника', 'error');
        return;
      }
      if (form.liable_kind === 'department' && !form.liable_department_id) {
        show('Выберите отдел-должник', 'error');
        return;
      }
    }
    const items = payloadItems();
    if (!items.length) {
      show('Заполните документ по учёту или добавьте товар', 'error');
      return;
    }
    if (andConfirm && form.items.some(needsSurplusCost)) {
      show('Укажите себестоимость излишка: на складе нет средней цены', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type: 'inventory',
        date: form.date,
        number: form.number,
        comment: form.comment,
        to_department_id: form.to_department_id,
        inventory_coverage: form.inventory_coverage === 'full' ? 'full' : 'partial',
        article_id: form.inventory_coverage === 'full' ? (form.article_id || null) : null,
        liable_user_id: form.inventory_coverage === 'full' && form.liable_kind === 'user'
          ? (form.liable_user_id || null)
          : null,
        liable_department_id: form.inventory_coverage === 'full' && form.liable_kind === 'department'
          ? (form.liable_department_id || null)
          : null,
        items,
        status: andConfirm ? 'confirmed' : 'draft',
      };
      let doc;
      if (form.id) {
        doc = await api.updateDocument(form.id, payload);
        if (andConfirm && doc.status !== 'confirmed') {
          doc = await api.confirmDocument(doc.id);
        }
      } else {
        doc = await api.createDocument(payload);
      }
      show(andConfirm ? 'Документ проведён' : 'Сохранено');
      setProductModalOpen(false);
      setModal(null);
      await loadDocs();
      return doc;
    } catch (e) {
      show(e.message || 'Ошибка сохранения', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelDoc = async () => {
    if (!form.id) return;
    if (!window.confirm('Отменить проведение? Остатки и P&L откатятся, документ снова станет черновиком.')) return;
    setSaving(true);
    try {
      await api.cancelDocument(form.id);
      show('Проведение отменено — можно править');
      await loadDocs();
      await openDoc(form.id, false, 'setup');
    } catch (e) {
      show(e.message || 'Не удалось отменить', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteDoc = async (id) => {
    if (!window.confirm('Удалить документ инвентаризации?')) return;
    try {
      await api.deleteDocument(id);
      show('Удалено');
      if (modal === id) setModal(null);
      await loadDocs();
    } catch (e) {
      show(e.message || 'Не удалось удалить', 'error');
    }
  };

  const modalTitle = form.id
    ? `Инвентаризация №${form.number || ''}`
    : 'Новая инвентаризация';

  return (
    <div className={`inventory-page${canEdit ? ' inventory-page--fab' : ''}`}>
      {Toast}
      {isPhone && topbarEl && createPortal(
        <>
          <div className="inventory-topbar-heading">
            <h1>Инвентаризация</h1>
            <BranchChip>{branchName}</BranchChip>
          </div>
          {canEdit && (
            <button type="button" className="inventory-topbar-new" onClick={openCreate}>
              <IconPlus />
              <span>Новый</span>
            </button>
          )}
        </>,
        topbarEl,
      )}

      <div className="page-header inventory-page-header">
        <div className="inventory-page-heading">
          <h1>Инвентаризация</h1>
          <p className="inventory-page-lead">Сверка факта с учётом по отделу</p>
          <BranchChip>{branchName}</BranchChip>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary inventory-new-btn" onClick={openCreate}>
            <IconPlus /> Новый
          </button>
        )}
      </div>

      <div className="card inventory-list-panel">
        <div className="card-header report-toolbar inventory-toolbar">
          <div className="inventory-status-chips" role="tablist" aria-label="Статус">
            {[
              { value: '', label: 'Все' },
              { value: 'draft', label: 'Черновик' },
              { value: 'confirmed', label: 'Проведён' },
              { value: 'cancelled', label: 'Отменён' },
            ].map((opt) => (
              <button
                key={opt.value || 'all'}
                type="button"
                role="tab"
                aria-selected={filterStatus === opt.value}
                className={`inventory-chip${filterStatus === opt.value ? ' is-active' : ''}`}
                onClick={() => setFilterStatus(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="report-filters inventory-date-filters">
            <label>
              С
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </label>
            <label>
              По
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </label>
            <label className="inventory-status-select">
              Статус
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">Все</option>
                <option value="draft">Черновик</option>
                <option value="confirmed">Проведён</option>
                <option value="cancelled">Отменён</option>
              </select>
            </label>
          </div>
        </div>
        <div className="table-wrap inventory-list-table">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Номер</th>
                <th>Отдел</th>
                <th className="col-num">Недостача − излишек</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="empty">Загрузка…</td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={6} className="empty">Нет документов</td></tr>
              ) : docs.map((d) => (
                <tr key={d.id}>
                  <td>{formatDate(d.date)}</td>
                  <td>
                    {d.number}
                    {d.inventory_coverage === 'full' ? (
                      <div className="inv-list-sub">Полная</div>
                    ) : null}
                    {d.remainder_document?.number ? (
                      <div className="inv-list-sub">Списание №{d.remainder_document.number}</div>
                    ) : null}
                  </td>
                  <td>{d.to_department_name || '—'}</td>
                  <td className="col-num">{formatMoney(d.total_amount)}</td>
                  <td><span className={`badge badge-${d.status}`}>{STATUS_LABELS[d.status]}</span></td>
                  <td>
                    <div className="btn-group btn-group-icons doc-actions">
                      {canEdit && (
                        <IconButton title="Редактировать" onClick={() => editDoc(d)}>
                          <IconEdit />
                        </IconButton>
                      )}
                      <IconButton
                        title={d.status === 'confirmed' && !canEdit ? 'Просмотр' : 'Открыть'}
                        onClick={() => openDoc(d.id, d.status !== 'draft')}
                      >
                        <IconEye />
                      </IconButton>
                      {canDelete && d.status !== 'confirmed' && (
                        <IconButton title="Удалить" onClick={() => deleteDoc(d.id)}>
                          <IconTrash />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="inventory-list-cards" ref={listRef}>
          {loading ? (
            <div className="inventory-list-empty">Загрузка…</div>
          ) : docs.length === 0 ? (
            <div className="inventory-list-empty">Нет документов</div>
          ) : docs.map((d) => (
            <InventoryDocCard
              key={d.id}
              doc={d}
              canEdit={canEdit}
              canDelete={canDelete}
              onOpen={openDoc}
              onEdit={editDoc}
              onDelete={deleteDoc}
            />
          ))}
        </div>
      </div>

      {modal && (
        <Modal
          className={`modal-doc modal-inventory${sheetTab === 'setup' ? ' modal-inventory--setup' : ' modal-inventory--items'}`}
          title={modalTitle}
          footerPlacement="end"
          onClose={() => {
            setProductModalOpen(false);
            setModal(null);
          }}
          footer={(
            sheetTab === 'setup' ? (
              <>
                <ModalCancelButton>Закрыть</ModalCancelButton>
                {canEdit && form.status === 'confirmed' && (
                  <button type="button" className="btn btn-ghost" onClick={cancelDoc} disabled={saving}>
                    Снять проведение
                  </button>
                )}
                {canEdit && form.status === 'draft' && form.id && (
                  <button type="button" className="btn btn-ghost" onClick={() => save(false)} disabled={saving}>
                    Сохранить
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={goToItemsTab}
                  disabled={!canGoToItems}
                >
                  Далее →
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setSheetTab('setup')}>
                  ← Назад
                </button>
                {canEdit && form.status === 'confirmed' && (
                  <button type="button" className="btn btn-ghost" onClick={cancelDoc} disabled={saving}>
                    Снять проведение
                  </button>
                )}
                {canEdit && form.status === 'draft' && (
                  <>
                    <button type="button" className="btn btn-ghost" onClick={() => save(false)} disabled={saving}>
                      Сохранить
                    </button>
                    {canConfirm && (
                      <button type="button" className="btn btn-success" onClick={() => save(true)} disabled={saving}>
                        Провести
                      </button>
                    )}
                  </>
                )}
                {(!canEdit || (form.status !== 'draft' && form.status !== 'confirmed')) && (
                  <ModalCancelButton>Закрыть</ModalCancelButton>
                )}
              </>
            )
          )}
        >
          <div className="doc-modal">
            <div className="inv-sheet-tabs" role="tablist" aria-label="Шаги инвентаризации">
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === 'setup'}
                className={`inv-sheet-tab${sheetTab === 'setup' ? ' is-active' : ''}`}
                onClick={() => setSheetTab('setup')}
              >
                1. Документ
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sheetTab === 'items'}
                className={`inv-sheet-tab${sheetTab === 'items' ? ' is-active' : ''}`}
                onClick={goToItemsTab}
                disabled={!canGoToItems && sheetTab !== 'items'}
              >
                2. Товары
                {form.items.length > 0 ? ` (${form.items.length})` : ''}
              </button>
            </div>

            {sheetTab === 'setup' ? (
              <div className="inv-sheet-setup">
                <div className="inv-setup-meta">
                  <div className="form-group form-group-date">
                    <label>Дата</label>
                    <input
                      type="date"
                      value={form.date}
                      disabled={readOnly}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                    />
                  </div>
                  <div className="form-group form-group-number">
                    <label>№</label>
                    <input value={form.number} disabled readOnly />
                  </div>
                </div>

                <div className="inv-dept-block">
                  <div className="inv-dept-label">Отдел *</div>
                  {branchDepartments.length === 0 ? (
                    <div className="inventory-list-empty">Нет отделов филиала</div>
                  ) : (
                    <div className="inv-dept-cubes">
                      {branchDepartments.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={cubeClass(d.id, form.to_department_id === d.id)}
                          disabled={readOnly}
                          onClick={() => selectDepartment(d.id)}
                        >
                          <span className="inv-dept-cube-name">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="inv-coverage-block">
                  <div className="inv-dept-label">Покрытие *</div>
                  <div className="inv-dept-cubes inv-coverage-cubes" role="tablist" aria-label="Тип инвентаризации">
                    <button
                      type="button"
                      className={`inv-dept-cube inv-cube-tone-0${form.inventory_coverage !== 'full' ? ' is-selected' : ''}`}
                      disabled={readOnly}
                      onClick={() => setCoverage('partial')}
                    >
                      <span className="inv-dept-cube-name">Частичная</span>
                      <span className="inv-dept-cube-sub">Только что изменили</span>
                    </button>
                    <button
                      type="button"
                      className={`inv-dept-cube inv-cube-tone-4${form.inventory_coverage === 'full' ? ' is-selected' : ''}`}
                      disabled={readOnly}
                      onClick={() => setCoverage('full')}
                    >
                      <span className="inv-dept-cube-name">Полная</span>
                      <span className="inv-dept-cube-sub">Невыбранное спишем</span>
                    </button>
                  </div>
                </div>

                {form.inventory_coverage === 'full' && (
                  <div className="inv-full-settle">
                    <div className="form-group">
                      <label>Статья списания *</label>
                      <select
                        value={form.article_id}
                        disabled={readOnly}
                        onChange={(e) => setForm({ ...form, article_id: e.target.value })}
                      >
                        <option value="">Выберите статью</option>
                        {invOptions.expense_articles.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="inv-dept-block">
                      <div className="inv-dept-label">Кто закрывает сумму</div>
                      <div className="inv-dept-cubes inv-liable-cubes" role="tablist" aria-label="Должник">
                        <button
                          type="button"
                          className={`inv-dept-cube inv-cube-tone-3${form.liable_kind === 'none' ? ' is-selected' : ''}`}
                          disabled={readOnly}
                          onClick={() => setLiableKind('none')}
                        >
                          <span className="inv-dept-cube-name">В расход</span>
                          <span className="inv-dept-cube-sub">Без должника</span>
                        </button>
                        <button
                          type="button"
                          className={`inv-dept-cube inv-cube-tone-6${form.liable_kind === 'user' ? ' is-selected' : ''}`}
                          disabled={readOnly}
                          onClick={() => setLiableKind('user')}
                        >
                          <span className="inv-dept-cube-name">Сотрудник</span>
                          <span className="inv-dept-cube-sub">Повесить долг</span>
                        </button>
                        <button
                          type="button"
                          className={`inv-dept-cube inv-cube-tone-1${form.liable_kind === 'department' ? ' is-selected' : ''}`}
                          disabled={readOnly}
                          onClick={() => setLiableKind('department')}
                        >
                          <span className="inv-dept-cube-name">Отдел</span>
                          <span className="inv-dept-cube-sub">Повесить долг</span>
                        </button>
                      </div>
                    </div>
                    {form.liable_kind === 'user' && (
                      <div className="inv-dept-block">
                        <div className="inv-dept-label">Сотрудник *</div>
                        {invOptions.users.length === 0 ? (
                          <div className="inventory-list-empty">Нет сотрудников филиала</div>
                        ) : (
                          <div className="inv-dept-cubes">
                            {invOptions.users.map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                className={cubeClass(u.id, form.liable_user_id === u.id)}
                                disabled={readOnly}
                                onClick={() => setForm({ ...form, liable_user_id: u.id })}
                              >
                                <span className="inv-dept-cube-name">{u.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {form.liable_kind === 'department' && (
                      <div className="inv-dept-block">
                        <div className="inv-dept-label">Отдел-должник *</div>
                        {branchDepartments.length === 0 ? (
                          <div className="inventory-list-empty">Нет отделов филиала</div>
                        ) : (
                          <div className="inv-dept-cubes">
                            {branchDepartments.map((d) => (
                              <button
                                key={d.id}
                                type="button"
                                className={cubeClass(d.id, form.liable_department_id === d.id)}
                                disabled={readOnly}
                                onClick={() => setForm({ ...form, liable_department_id: d.id })}
                              >
                                <span className="inv-dept-cube-name">{d.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {form.remainder_document?.number && (
                  <div className="inv-remainder-note">
                    Списание непересчитанного №{form.remainder_document.number}
                    {' · '}
                    {form.remainder_document.article_name || 'статья'}
                    {form.remainder_document.liable_user_name
                      ? ` · ${form.remainder_document.liable_user_name}`
                      : form.remainder_document.liable_department_name
                        ? ` · ${form.remainder_document.liable_department_name}`
                        : ''}
                    {' · '}
                    {formatMoney(form.remainder_document.total_amount)}
                    {form.remainder_document.status === 'cancelled' ? ' (отменено)' : ''}
                  </div>
                )}

                {(!isPhone || commentOpen || form.comment) ? (
                  <div className="form-group form-group-comment">
                    <label>Комментарий</label>
                    <input
                      value={form.comment}
                      disabled={readOnly}
                      onChange={(e) => setForm({ ...form, comment: e.target.value })}
                      placeholder="Необязательно"
                    />
                  </div>
                ) : (
                  !readOnly && (
                    <button
                      type="button"
                      className="inv-comment-toggle"
                      onClick={() => setCommentOpen(true)}
                    >
                      + Комментарий
                    </button>
                  )
                )}
              </div>
            ) : (
              <>
                <div className="inv-sheet-top">
                  <div className="inv-items-context">
                    <span>{form.date}</span>
                    <span>·</span>
                    <strong>{selectedDepartment?.name || 'Отдел'}</strong>
                    {form.number ? <span className="inv-items-context-num">№{form.number}</span> : null}
                  </div>

                  <div className="inv-toolbar">
                    {canEdit && !readOnly && (
                      <button
                        type="button"
                        className="btn btn-ghost inv-fill-btn"
                        onClick={fillFromStock}
                        disabled={filling || !form.to_department_id}
                      >
                        {filling ? '…' : 'Заполнить по учёту'}
                      </button>
                    )}
                    <div className="inv-line-filter" role="tablist" aria-label="Фильтр строк">
                      <button
                        type="button"
                        className={`btn btn-ghost${lineFilter === 'all' ? ' is-active' : ''}`}
                        onClick={() => setLineFilter('all')}
                      >
                        Все
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost${lineFilter === 'discrepancies' ? ' is-active' : ''}`}
                        onClick={() => setLineFilter('discrepancies')}
                      >
                        Расхожд.
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-ghost inv-show-amount-toggle${showAmount ? ' is-active' : ''}`}
                      onClick={toggleShowAmount}
                      title={showAmount ? 'Скрыть сумму' : 'Показать сумму'}
                    >
                      {showAmount ? 'Сумма ✓' : 'Только кол-во'}
                    </button>
                  </div>

                  <div className="inv-work-bar">
                    <input
                      type="search"
                      className="inv-item-search"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Поиск товара…"
                      enterKeyHint="search"
                      autoComplete="off"
                    />
                    {canEdit && !readOnly && (
                      <div className="inv-add-line">
                        <div className="quick-add-control">
                          <ProductSelect
                            products={products}
                            value={addPick}
                            onChange={addLine}
                            placeholder={productsLoading || addingLine ? 'Загрузка…' : 'Добавить…'}
                            disabled={!form.to_department_id || productsLoading || addingLine}
                          />
                          {canCreateProduct && (
                            <button
                              type="button"
                              className="btn btn-icon btn-ghost quick-add-button"
                              title="Создать новый товар"
                              aria-label="Создать новый товар"
                              disabled={!form.to_department_id || addingLine}
                              onClick={() => setProductModalOpen(true)}
                            >
                              <IconPlus />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="inv-sheet-scroll">
                  {!isPhone && (
                    <div className="table-wrap items-table inventory-items-table doc-modal-items-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Товар</th>
                            <th>Ед.</th>
                            <th className="col-num">Учёт</th>
                            <th className="col-num">Факт</th>
                            <th className="col-num">Разница</th>
                            {showAmount && <th className="col-num">Сумма</th>}
                            {showSurplusCostCol && <th className="col-num">Себест.</th>}
                            {!readOnly && <th />}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleItems.length === 0 ? (
                            <tr>
                              <td colSpan={(showAmount ? 6 : 5) + (showSurplusCostCol ? 1 : 0) + (readOnly ? 0 : 1)} className="empty">
                                {form.items.length === 0
                                  ? 'Заполните по учёту или добавьте товар'
                                  : itemSearch.trim()
                                    ? 'Ничего не найдено'
                                    : 'Нет расхождений'}
                              </td>
                            </tr>
                          ) : visibleItems.map(({ item, idx }) => {
                            const diff = lineDiff(item);
                            const amount = lineAmount(item);
                            const diffClass = diff > 1e-9 ? 'inv-diff-pos' : diff < -1e-9 ? 'inv-diff-neg' : '';
                            return (
                              <tr key={`${item.product_id}:${item.variant_id || ''}:${idx}`} className={diffClass ? 'inv-row-discrepancy' : undefined}>
                                <td>{productName(products, item)}</td>
                                <td>{productUnit(products, item)}</td>
                                <td className="col-num inv-book-muted">{formatQty(lineBook(item))}</td>
                                <td>
                                  {readOnly ? (
                                    formatQty(lineFact(item))
                                  ) : (
                                    <input
                                      className="input-qty"
                                      inputMode="decimal"
                                      value={item.quantity ?? ''}
                                      onChange={(e) => updateFact(idx, e.target.value)}
                                    />
                                  )}
                                </td>
                                <td className={`col-num ${diffClass}`}>{formatQty(diff)}</td>
                                {showAmount && <td className="col-num">{formatMoney(amount)}</td>}
                                {showSurplusCostCol && (
                                  <td>
                                    {needsSurplusCost(item) ? (
                                      <input
                                        className="input-qty"
                                        inputMode="decimal"
                                        value={item.unit_cost_input ?? (item.unit_cost ? formatPriceInput(item.unit_cost) : '')}
                                        onChange={(e) => updateCost(idx, e.target.value)}
                                        placeholder="0,00"
                                      />
                                    ) : '—'}
                                  </td>
                                )}
                                {!readOnly && (
                                  <td>
                                    <IconButton title="Убрать" onClick={() => removeItem(idx)}>
                                      <IconTrash />
                                    </IconButton>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className={`inventory-items-cards${isPhone ? ' is-phone' : ''}`}>
                    {visibleItems.length === 0 ? (
                      <div className="inventory-list-empty">
                        {form.items.length === 0
                          ? 'Заполните по учёту или добавьте товар из списка'
                          : itemSearch.trim()
                            ? 'Ничего не найдено'
                            : 'Нет расхождений'}
                      </div>
                    ) : visibleItems.map(({ item, idx }) => (
                      <InventoryLineCard
                        key={`${item.product_id}:${item.variant_id || ''}:${idx}`}
                        item={item}
                        idx={idx}
                        products={products}
                        readOnly={readOnly}
                        onFact={updateFact}
                        onCost={updateCost}
                        onRemove={removeItem}
                        compact={isPhone}
                        showAmount={showAmount}
                      />
                    ))}
                  </div>
                </div>

                <div className={`doc-modal-totals${showAmount ? '' : ' is-qty-only'}`}>
                  {showAmount ? (
                    <>
                      <div>− {formatMoney(totals.shortage)}</div>
                      <div>+ {formatMoney(totals.surplus)}</div>
                      <div className="doc-modal-total">
                        <strong>Нетто {formatMoney(totals.net)}</strong>
                      </div>
                    </>
                  ) : (
                    <div className="doc-modal-total">
                      <strong>Позиций: {form.items.length}</strong>
                      {lineFilter === 'discrepancies' ? ` · расхождений: ${visibleItems.length}` : ''}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
      <ProductCreateModal
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        onCreated={onQuickProductCreated}
      />
      {canEdit && !isPhone && (
        <button type="button" className="inventory-fab" onClick={openCreate}>
          <IconPlus /> Новый
        </button>
      )}
    </div>
  );
}
