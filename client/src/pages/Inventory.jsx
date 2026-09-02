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
import { IconButton, IconCheck, IconEdit, IconEye, IconPlus, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import ProductSelect from '../components/ProductSelect';
import ProductCreateModal from '../components/ProductCreateModal';
import { encodeProductPick, resolvePickFromProducts } from '../utils/productVariants';
import { hasPermission } from '../permissions';
import { todayLocalIso } from '../utils/date';
import { textMatchesSearch } from '../utils/searchNormalize';
import {
  formDraftKey,
  readFormDraft,
  clearFormDraft,
  promptRestoreDraft,
  useFormDraft,
} from '../hooks/useFormDraft';
import { useFormDirty } from '../hooks/useFormDirty';

const INVENTORY_PHONE_MQ = '(max-width: 768px)';
const INV_ACTIVE_MODAL_KEY = 'inventory-active-modal';

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
    remainder_amount: 0,
    remainder_items: [],
    counted_amount: 0,
    stock_amount: 0,
    items: [],
  };
}

function readActiveInventoryModal() {
  try {
    return sessionStorage.getItem(INV_ACTIVE_MODAL_KEY) || '';
  } catch {
    return '';
  }
}

function writeActiveInventoryModal(id) {
  try {
    if (id) sessionStorage.setItem(INV_ACTIVE_MODAL_KEY, String(id));
    else sessionStorage.removeItem(INV_ACTIVE_MODAL_KEY);
  } catch { /* ignore */ }
}

function closeInventoryWork(modalId) {
  clearFormDraft(formDraftKey('inventory', modalId || 'create'));
  if (modalId && modalId !== 'create') clearFormDraft(formDraftKey('inventory', 'create'));
  writeActiveInventoryModal('');
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

function CubeCheck({ selected }) {
  if (!selected) return null;
  return (
    <span className="inv-dept-cube-check" aria-hidden="true">
      <IconCheck />
    </span>
  );
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

function lineNet(item) {
  const parsed = parseQuantityInput(item.net_weight);
  if (parsed != null) return parsed;
  return Number(item.net_weight) || 0;
}

function lineFactStock(item) {
  const fact = lineFact(item);
  const net = lineNet(item);
  return net > 0 ? net * fact : fact;
}

function lineDiff(item) {
  return lineFactStock(item) - lineBook(item);
}

function lineAmount(item) {
  return Math.abs(lineDiff(item)) * lineCost(item);
}

function lineStockAmount(item) {
  return lineFactStock(item) * lineCost(item);
}

function catalogNetValue(source) {
  const n = Number(source?.net_weight);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function roundQty3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function factQtyFromBook(book, net) {
  const n = Number(net) || 0;
  const b = Number(book) || 0;
  if (n > 0) return String(roundQty3(b / n));
  return String(b);
}

function qtyField(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function mapInventoryFormItem(item) {
  const net = Number(item?.net_weight);
  return {
    product_id: item.product_id,
    variant_id: item.variant_id || null,
    product_name: item.product_name,
    variant_name: item.variant_name || null,
    unit: item.unit,
    book_qty: Number(item.book_qty) || 0,
    quantity: qtyField(item.quantity),
    net_weight: Number.isFinite(net) && net > 0 ? String(net) : qtyField(item.net_weight),
    unit_cost: Number(item.unit_cost) || Number(item.price) || 0,
  };
}

function mergeSavedInventoryItems(serverItems, localItems) {
  if (!Array.isArray(serverItems) || serverItems.length === 0) return localItems || [];
  const localByKey = new Map((localItems || []).map((item) => [remainderLineKey(item), item]));
  return serverItems.map((server) => {
    const mapped = mapInventoryFormItem(server);
    const local = localByKey.get(remainderLineKey(server));
    if (!local) return mapped;
    const serverNet = lineNet(mapped);
    const localNet = lineNet(local);
    return {
      ...mapped,
      quantity: mapped.quantity !== '' ? mapped.quantity : qtyField(local.quantity),
      net_weight: serverNet > 0 ? mapped.net_weight : (localNet > 0 ? qtyField(local.net_weight) : mapped.net_weight),
      unit_cost: mapped.unit_cost || local.unit_cost,
      unit_cost_input: local.unit_cost_input,
      unit: mapped.unit || local.unit,
      product_name: mapped.product_name || local.product_name,
      variant_name: mapped.variant_name ?? local.variant_name,
    };
  });
}

function mergeFillInventoryItems(existingItems, rows, catalog) {
  const existingByKey = new Map((existingItems || []).map((item) => [remainderLineKey(item), item]));
  const used = new Set();
  const fromStock = (rows || []).map((row) => {
    const key = remainderLineKey(row);
    used.add(key);
    const existing = existingByKey.get(key);
    const product = (catalog || []).find((p) => p.id === row.product_id);
    const catalogNet = catalogNetValue(row) || catalogNetValue(product);
    const keepNet = existing && lineNet(existing) > 0 ? lineNet(existing) : catalogNet;
    const hasEnteredFact = existing && existing.quantity !== '' && existing.quantity != null;
    return {
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      product_name: existing?.product_name || row.name,
      variant_name: existing?.variant_name ?? row.variant_name ?? null,
      unit: existing?.unit || row.unit,
      book_qty: Number(row.book_qty) || 0,
      quantity: hasEnteredFact ? existing.quantity : factQtyFromBook(row.book_qty, keepNet),
      net_weight: keepNet > 0 ? String(keepNet) : (existing?.net_weight ?? ''),
      unit_cost: Number(existing?.unit_cost) || Number(row.avg_cost) || Number(row.suggest_cost) || 0,
      unit_cost_input: existing?.unit_cost_input,
    };
  });
  const extras = (existingItems || []).filter((item) => !used.has(remainderLineKey(item)));
  return [...fromStock, ...extras];
}

function lineStockHint(item, unit) {
  const net = lineNet(item);
  const qty = lineFact(item);
  if (!(net > 0) || !(qty > 0)) return '';
  return `на склад: ${formatQty(net * qty)}${unit ? ` ${unit}` : ''}`;
}

function inventoryStockAmount(doc) {
  return Number(doc.stock_amount) || 0;
}

function mapRemainderItems(doc) {
  return (doc.remainder_items || []).map((item) => ({
    product_id: item.product_id,
    variant_id: item.variant_id || null,
    product_name: item.product_name,
    variant_name: item.variant_name || null,
    unit: item.unit || 'шт',
    book_qty: Number(item.book_qty) || 0,
    quantity: Number(item.quantity) || 0,
    unit_cost: Number(item.unit_cost) || Number(item.price) || 0,
    amount: Number(item.amount) || 0,
  }));
}

function remainderLineAmount(item) {
  const stored = Number(item.amount);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return (Number(item.book_qty) || 0) * (Number(item.unit_cost) || 0);
}

function remainderLineKey(item) {
  return `${item.product_id}:${item.variant_id || ''}`;
}

function needsSurplusCost(item) {
  return lineDiff(item) > 1e-9 && !(lineCost(item) > 0);
}

function productUnit(products, item) {
  const pick = resolvePickFromProducts(products, encodeProductPick(item.product_id, item.variant_id));
  return pick.variant?.unit || pick.product?.unit || item.unit || 'шт';
}

function productName(products, item) {
  const pick = resolvePickFromProducts(products, encodeProductPick(item.product_id, item.variant_id));
  const base = pick.product?.name || item.product_name || '—';
  const variant = pick.variant?.name || item.variant_name;
  if (variant && !String(base).includes(variant)) return `${base} — ${variant}`;
  return base;
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
          <span className="inventory-doc-card-sum">{formatMoney(inventoryStockAmount(doc))}</span>
        </div>
        {(Number(doc.shortage_total) > 0 || Number(doc.surplus_total) > 0) ? (
          <div className="inventory-doc-card-diff">
            {Number(doc.shortage_total) > 0 ? `− ${formatMoney(doc.shortage_total)}` : ''}
            {Number(doc.shortage_total) > 0 && Number(doc.surplus_total) > 0 ? ' · ' : ''}
            {Number(doc.surplus_total) > 0 ? `+ ${formatMoney(doc.surplus_total)}` : ''}
          </div>
        ) : null}
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
        ) : Number(doc.remainder_amount) > 0 ? (
          <div className="inventory-doc-card-remainder">
            Списание {formatMoney(doc.remainder_amount)}
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

function InventoryWriteoffBlock({ items, products, showAmount, isPhone, confirmed }) {
  if (!items.length) return null;
  return (
    <section className="inv-writeoff" id="inv-writeoff">
      <div className="inv-writeoff-head">
        Не пересчитано — спишется
        <span className="inv-writeoff-hint">
          {confirmed ? 'остаток обнуляется' : 'нет в списке пересчёта'}
        </span>
      </div>
      {!isPhone && (
        <div className="table-wrap items-table inventory-items-table">
          <table>
            <thead>
              <tr>
                <th className="inv-row-num">№</th>
                <th>Товар</th>
                <th>Ед.</th>
                <th className="col-num">Учёт</th>
                <th className="col-num">Факт</th>
                {showAmount ? <th className="col-num inv-col-cost">Себест.</th> : null}
                {showAmount ? <th className="col-num inv-col-amount">Сумма</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item, row) => (
                <tr key={remainderLineKey(item)}>
                  <td className="inv-row-num">{row + 1}</td>
                  <td>{productName(products, item)}</td>
                  <td>{productUnit(products, item)}</td>
                  <td className="col-num">{formatQty(item.book_qty)}</td>
                  <td className="col-num">0</td>
                  {showAmount ? (
                    <td className="col-num inv-col-cost">
                      {Number(item.unit_cost) > 0 ? formatMoney(item.unit_cost) : '—'}
                    </td>
                  ) : null}
                  {showAmount ? (
                    <td className="col-num inv-col-amount">{formatMoney(remainderLineAmount(item))}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={`inventory-items-cards inv-writeoff-cards${isPhone ? ' is-phone' : ''}`}>
        {items.map((item, row) => (
          <article
            key={remainderLineKey(item)}
            className="inventory-line-card inventory-line-card--compact inv-writeoff-card"
          >
            <div className="inventory-line-card-head">
              <div>
                <span className="inv-line-num">{row + 1}.</span>
                <strong>{productName(products, item)}</strong>
              </div>
            </div>
            <div className={`inventory-line-card-compact-row${showAmount ? '' : ' is-qty-only'}`}>
              <div className="inventory-line-card-compact-meta">
                <span>Учёт</span>
                <b>{formatQty(item.book_qty)}</b>
              </div>
              <div className="inventory-line-card-compact-meta">
                <span>Факт</span>
                <b>0</b>
              </div>
              {showAmount ? (
                <div className="inventory-line-card-compact-meta">
                  <span>Себест.</span>
                  <b className="inv-col-cost">
                    {Number(item.unit_cost) > 0 ? formatMoney(item.unit_cost) : '—'}
                  </b>
                </div>
              ) : (
                <div className="inventory-line-card-compact-meta">
                  <span>Ед.</span>
                  <b>{productUnit(products, item)}</b>
                </div>
              )}
              {showAmount ? (
                <div className="inventory-line-card-compact-meta">
                  <span>Сумма</span>
                  <b className="inv-col-amount">{formatMoney(remainderLineAmount(item))}</b>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function InventoryNetField({ item, idx, unit, readOnly, onNet }) {
  const hint = lineStockHint(item, unit);
  const netDisplay = lineNet(item);
  return (
    <div className={`doc-items-net-wrap${hint ? ' has-hint' : ''}`}>
      {readOnly ? (
        <b>{netDisplay > 0 ? formatQty(netDisplay) : '—'}</b>
      ) : (
        <input
          className="input-qty"
          inputMode="decimal"
          value={item.net_weight ?? ''}
          placeholder="на 1 шт"
          onChange={(e) => onNet(idx, e.target.value)}
        />
      )}
      {hint ? <span className="doc-items-net-hint">{hint}</span> : null}
    </div>
  );
}

function InventoryLineCard({
  item, idx, num, products, readOnly, onFact, onNet, onCost, onRemove, compact, showAmount = true,
}) {
  const diff = lineDiff(item);
  const amount = lineAmount(item);
  const unit = productUnit(products, item);
  const cost = lineCost(item);
  const diffClass = diff > 1e-9 ? 'inv-diff-pos' : diff < -1e-9 ? 'inv-diff-neg' : '';
  const canEditCost = !readOnly && needsSurplusCost(item);
  const costField = showAmount ? (
    <div className="inventory-line-card-cost">
      <span>{canEditCost ? 'Себест. излишка' : 'Себест.'}</span>
      {canEditCost ? (
        <input
          className="input-qty inv-cost-input"
          inputMode="decimal"
          value={item.unit_cost_input ?? (cost ? formatPriceInput(cost) : '')}
          onChange={(e) => onCost(idx, e.target.value)}
          placeholder="0,00"
        />
      ) : (
        <b className="inv-col-cost">{cost > 0 ? formatMoney(cost) : '—'}</b>
      )}
    </div>
  ) : null;
  const netField = (
    <InventoryNetField item={item} idx={idx} unit={unit} readOnly={readOnly} onNet={onNet} />
  );
  if (compact) {
    return (
      <article className={`inventory-line-card inventory-line-card--compact${diffClass ? ' inv-row-discrepancy' : ''}`}>
        <div className="inventory-line-card-head">
          <div>
            {num != null ? <span className="inv-line-num">{num}.</span> : null}
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
              <b className="inv-col-amount">{formatMoney(amount)}</b>
            </div>
          ) : null}
        </div>
        <div className="inventory-line-card-net-row">
          <div className="inventory-line-card-compact-meta">
            <span>Ед.</span>
            <b>{unit}</b>
          </div>
          <div className="inventory-line-card-compact-fact">
            <span>Нетто</span>
            {netField}
          </div>
        </div>
        {costField}
      </article>
    );
  }
  return (
    <article className={`inventory-line-card${diffClass ? ' inv-row-discrepancy' : ''}`}>
      <div className="inventory-line-card-head">
        <div>
          {num != null ? <span className="inv-line-num">{num}.</span> : null}
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
          <span>Нетто</span>
          {netField}
        </div>
        <div>
          <span>Разница</span>
          <b className={diffClass}>{formatQty(diff)}</b>
        </div>
        {showAmount ? (
          <>
            <div>
              <span>Себест.</span>
              {canEditCost ? (
                <input
                  className="input-qty inv-cost-input"
                  inputMode="decimal"
                  value={item.unit_cost_input ?? (cost ? formatPriceInput(cost) : '')}
                  onChange={(e) => onCost(idx, e.target.value)}
                  placeholder="0,00"
                />
              ) : (
                <b className="inv-col-cost">{cost > 0 ? formatMoney(cost) : '—'}</b>
              )}
            </div>
            <div>
              <span>Сумма</span>
              <b className="inv-col-amount">{formatMoney(amount)}</b>
            </div>
          </>
        ) : (
          <div>
            <span>Ед. изм.</span>
            <b>{unit}</b>
          </div>
        )}
      </div>
      {canEditCost && !showAmount ? costField : null}
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
  const modalRef = useRef(modal);
  const restoredRef = useRef(false);
  const [savedTick, setSavedTick] = useState(0);
  modalRef.current = modal;

  const draftKey = formDraftKey('inventory', modal);
  const draftPayload = useMemo(() => ({
    form,
    sheetTab,
    commentOpen,
    readOnly,
  }), [form, sheetTab, commentOpen, readOnly]);
  useFormDraft(draftKey, draftPayload, Boolean(modal) && !readOnly);
  const isFormDirty = useFormDirty(draftPayload, modal ? `${draftKey}:${savedTick}` : null);
  const isWorking = Boolean(modal) && !readOnly && (saving || isFormDirty);

  useEffect(() => {
    writeActiveInventoryModal(modal || '');
  }, [modal]);

  useEffect(() => {
    if (!isWorking) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isWorking]);

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
    if (!modalRef.current) setLoading(true);
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
    if (productsReady && productsBranchRef.current === branchKey) return products;
    setProductsLoading(true);
    try {
      const prods = await api.getProducts({ limit: 5000 });
      const list = Array.isArray(prods) ? prods : (prods?.items || []);
      setProducts(list);
      productsBranchRef.current = branchKey;
      setProductsReady(true);
      return list;
    } catch (e) {
      show(e.message || 'Не удалось загрузить товары', 'error');
      return products;
    } finally {
      setProductsLoading(false);
    }
  }, [branchId, productsReady, products, show]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const active = readActiveInventoryModal();
    if (!active) return;
    const draft = readFormDraft(formDraftKey('inventory', active));
    if (!draft?.form || draft.form.status === 'confirmed') {
      writeActiveInventoryModal('');
      return;
    }
    setForm(draft.form);
    setSheetTab(draft.sheetTab === 'items' ? 'items' : 'setup');
    setCommentOpen(Boolean(draft.commentOpen || draft.form.comment));
    setReadOnly(Boolean(draft.readOnly));
    setLineFilter('all');
    setItemSearch('');
    setAddPick('');
    setModal(active);
    ensureProducts();
  }, [ensureProducts]);

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

  const remainderItems = useMemo(() => {
    if (form.inventory_coverage !== 'full') return [];
    const rows = form.remainder_items || [];
    if (form.status === 'confirmed') return rows;
    const counted = new Set(form.items.map(remainderLineKey));
    return rows.filter((item) => !counted.has(remainderLineKey(item)));
  }, [form.inventory_coverage, form.remainder_items, form.items, form.status]);

  const visibleRemainderItems = useMemo(() => {
    const q = itemSearch.trim();
    if (!q) return remainderItems;
    return remainderItems.filter((item) => textMatchesSearch(productSearchHaystack(products, item), q));
  }, [remainderItems, itemSearch, products]);

  const totals = useMemo(() => {
    let shortage = 0;
    let surplus = 0;
    let stock = 0;
    for (const item of form.items) {
      const diff = lineDiff(item);
      const amount = Math.abs(diff) * lineCost(item);
      stock += lineStockAmount(item);
      if (diff < -1e-9) shortage += amount;
      else if (diff > 1e-9) surplus += amount;
    }
    const remainder = form.inventory_coverage === 'full'
      ? (form.status === 'confirmed'
        ? (Number(form.remainder_amount) || 0)
        : remainderItems.length
          ? remainderItems.reduce((sum, item) => sum + remainderLineAmount(item), 0)
          : (Number(form.remainder_amount) || 0))
      : 0;
    return {
      shortage,
      surplus,
      net: shortage - surplus,
      stock,
      remainder,
      stockTotal: stock + remainder,
    };
  }, [form.items, form.remainder_amount, form.inventory_coverage, form.status, remainderItems]);

  const listStockSum = useMemo(
    () => docs.reduce((sum, d) => sum + inventoryStockAmount(d), 0),
    [docs],
  );

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

  const openCreate = async () => {
    const deptId = branchDepartments.length === 1 ? branchDepartments[0].id : '';
    const existingDraft = docs.find((d) => (
      d.status === 'draft'
      && (!deptId || d.to_department_id === deptId)
    ));
    if (existingDraft && (deptId || docs.filter((d) => d.status === 'draft').length === 1)) {
      await openDoc(existingDraft.id, false, 'setup');
      return;
    }
    const next = emptyForm();
    if (branchDepartments.length === 1) next.to_department_id = branchDepartments[0].id;
    try {
      const { number } = await api.getNextDocNumber('inventory');
      next.number = number;
    } catch { /* ignore */ }
    const draft = readFormDraft(formDraftKey('inventory', 'create'));
    if (draft?.form && promptRestoreDraft(draft, 'черновик инвентаризации')) {
      setForm(draft.form);
      setSheetTab(draft.sheetTab === 'items' ? 'items' : 'setup');
      setCommentOpen(Boolean(draft.commentOpen || draft.form.comment));
    } else {
      if (draft) clearFormDraft(formDraftKey('inventory', 'create'));
      setForm(next);
      setSheetTab('setup');
      setCommentOpen(false);
    }
    setLineFilter('all');
    setItemSearch('');
    setAddPick('');
    setReadOnly(false);
    setSavedTick((tick) => tick + 1);
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
    if (!form.id) {
      const existingDraft = docs.find((d) => (
        d.status === 'draft' && d.to_department_id === departmentId
      ));
      if (existingDraft) {
        openDoc(existingDraft.id, false, sheetTab);
        return;
      }
    }
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
      const draft = !viewOnly ? readFormDraft(formDraftKey('inventory', id)) : null;
      if (draft?.form && draft.form.status !== 'confirmed' && promptRestoreDraft(draft, 'черновик инвентаризации')) {
        setForm(draft.form);
        setSheetTab(draft.sheetTab === 'items' ? 'items' : tab);
        setCommentOpen(Boolean(draft.commentOpen || draft.form.comment));
        setLineFilter('all');
        setItemSearch('');
        setAddPick('');
        setReadOnly(false);
        setSavedTick((tick) => tick + 1);
        setModal(id);
        ensureProducts();
        return;
      }
      if (draft) clearFormDraft(formDraftKey('inventory', id));
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
        remainder_amount: Number(doc.remainder_amount) || 0,
        remainder_items: mapRemainderItems(doc),
        counted_amount: Number(doc.counted_amount) || 0,
        stock_amount: Number(doc.stock_amount) || 0,
        items: (doc.items || []).map(mapInventoryFormItem),
      });
      setLineFilter('all');
      setItemSearch('');
      setCommentOpen(Boolean(doc.comment));
      setAddPick('');
      setSheetTab(tab);
      setReadOnly(viewOnly || doc.status !== 'draft');
      setSavedTick((tick) => tick + 1);
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
      const catalog = (await ensureProducts()) || [];
      const rows = await api.getInventoryStock(form.to_department_id);
      if (!rows.length) {
        show('В отделе нет позиций с остатком', 'error');
        return;
      }
      setForm((prev) => ({
        ...prev,
        items: mergeFillInventoryItems(prev.items, rows, catalog),
      }));
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
      const catalogAvg = Number(resolved.variant?.avg_cost) || Number(resolved.product?.avg_cost) || 0;
      const liveCost = Number(row?.avg_cost) || Number(row?.suggest_cost) || catalogAvg || 0;
      const net = catalogNetValue(resolved.product) || catalogNetValue(row);
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
              variant_name: resolved.variant?.name || null,
              unit,
              book_qty,
              quantity: factQtyFromBook(book_qty, net),
              net_weight: net > 0 ? String(net) : '',
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
    const quantity = normalizeQuantityInput(value);
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === idx ? { ...item, quantity } : item)),
    }));
  };

  const updateNet = (idx, value) => {
    const net_weight = normalizeQuantityInput(value);
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === idx ? { ...item, net_weight } : item)),
    }));
  };

  const updateCost = (idx, value) => {
    const unit_cost_input = formatPriceInput(value);
    const unit_cost = parsePriceInput(value) ?? 0;
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (
        i === idx ? { ...item, unit_cost_input, unit_cost } : item
      )),
    }));
  };

  const removeItem = (idx) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  };

  const payloadItems = () => form.items
    .filter((i) => i.product_id)
    .map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id || null,
      quantity: lineFact(i),
      book_qty: lineBook(i),
      net_weight: lineNet(i) > 0 ? lineNet(i) : null,
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
      if (andConfirm) {
        show('Документ проведён');
        closeInventoryWork(form.id || modal);
        closeInventoryWork('create');
        setProductModalOpen(false);
        setModal(null);
        await loadDocs();
        return doc;
      }
      show('Сохранено');
      if (modal === 'create') clearFormDraft(formDraftKey('inventory', 'create'));
      setForm((prev) => ({
        ...prev,
        id: doc.id,
        number: doc.number || prev.number,
        status: doc.status || 'draft',
        remainder_document: doc.remainder_document || null,
        remainder_amount: Number(doc.remainder_amount) || 0,
        remainder_items: mapRemainderItems(doc),
        counted_amount: Number(doc.counted_amount) || 0,
        stock_amount: Number(doc.stock_amount) || 0,
        items: mergeSavedInventoryItems(doc.items, prev.items),
      }));
      setSavedTick((tick) => tick + 1);
      setModal(doc.id);
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
      closeInventoryWork(id);
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
                <th className="col-num">Сумма остатков</th>
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
                  <td className="col-num">
                    {formatMoney(inventoryStockAmount(d))}
                    {(Number(d.shortage_total) > 0 || Number(d.surplus_total) > 0) ? (
                      <div className="inv-list-sub">
                        {Number(d.shortage_total) > 0 ? `− ${formatMoney(d.shortage_total)}` : ''}
                        {Number(d.shortage_total) > 0 && Number(d.surplus_total) > 0 ? ' · ' : ''}
                        {Number(d.surplus_total) > 0 ? `+ ${formatMoney(d.surplus_total)}` : ''}
                      </div>
                    ) : null}
                    {Number(d.remainder_amount) > 0 ? (
                      <div className="inv-list-sub">Списание {formatMoney(d.remainder_amount)}</div>
                    ) : null}
                  </td>
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
        {!loading && docs.length > 0 && (
          <div className="inventory-list-total">
            <span>Итого остатки</span>
            <strong>{formatMoney(listStockSum)}</strong>
          </div>
        )}
      </div>

      {modal && (
        <Modal
          className={`modal-doc modal-inventory${sheetTab === 'setup' ? ' modal-inventory--setup' : ' modal-inventory--items'}`}
          title={modalTitle}
          footerPlacement={isPhone ? 'end' : 'header'}
          dirty={isFormDirty}
          onClose={() => {
            closeInventoryWork(modal);
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
                {canEdit && form.status === 'draft' && (
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
                      <button
                        type="button"
                        className="btn btn-success inv-save-confirm"
                        onClick={() => save(true)}
                        disabled={saving}
                      >
                        Сохранить и провести
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

                <div className="inv-coverage-block">
                  <div className="inv-dept-label">Покрытие *</div>
                  <div className="inv-dept-cubes inv-coverage-cubes" role="tablist" aria-label="Тип инвентаризации">
                    <button
                      type="button"
                      className={`inv-dept-cube inv-cube-tone-0${form.inventory_coverage !== 'full' ? ' is-selected' : ''}`}
                      disabled={readOnly}
                      aria-pressed={form.inventory_coverage !== 'full'}
                      onClick={() => setCoverage('partial')}
                    >
                      <CubeCheck selected={form.inventory_coverage !== 'full'} />
                      <span className="inv-dept-cube-name">Частичная</span>
                      <span className="inv-dept-cube-sub">Только что изменили</span>
                    </button>
                    <button
                      type="button"
                      className={`inv-dept-cube inv-cube-tone-4${form.inventory_coverage === 'full' ? ' is-selected' : ''}`}
                      disabled={readOnly}
                      aria-pressed={form.inventory_coverage === 'full'}
                      onClick={() => setCoverage('full')}
                    >
                      <CubeCheck selected={form.inventory_coverage === 'full'} />
                      <span className="inv-dept-cube-name">Полная</span>
                      <span className="inv-dept-cube-sub">Невыбранное спишем</span>
                    </button>
                  </div>
                </div>

                <div className="inv-dept-block">
                  <div className="inv-dept-label">Отдел *</div>
                  {branchDepartments.length === 0 ? (
                    <div className="inventory-list-empty">Нет отделов филиала</div>
                  ) : (
                    <div className="inv-dept-cubes">
                      {branchDepartments.map((d) => {
                        const selected = form.to_department_id === d.id;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            className={cubeClass(d.id, selected)}
                            disabled={readOnly}
                            aria-pressed={selected}
                            onClick={() => selectDepartment(d.id)}
                          >
                            <CubeCheck selected={selected} />
                            <span className="inv-dept-cube-name">{d.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
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
                          aria-pressed={form.liable_kind === 'none'}
                          onClick={() => setLiableKind('none')}
                        >
                          <CubeCheck selected={form.liable_kind === 'none'} />
                          <span className="inv-dept-cube-name">В расход</span>
                          <span className="inv-dept-cube-sub">Без должника</span>
                        </button>
                        <button
                          type="button"
                          className={`inv-dept-cube inv-cube-tone-6${form.liable_kind === 'user' ? ' is-selected' : ''}`}
                          disabled={readOnly}
                          aria-pressed={form.liable_kind === 'user'}
                          onClick={() => setLiableKind('user')}
                        >
                          <CubeCheck selected={form.liable_kind === 'user'} />
                          <span className="inv-dept-cube-name">Сотрудник</span>
                          <span className="inv-dept-cube-sub">Повесить долг</span>
                        </button>
                        <button
                          type="button"
                          className={`inv-dept-cube inv-cube-tone-1${form.liable_kind === 'department' ? ' is-selected' : ''}`}
                          disabled={readOnly}
                          aria-pressed={form.liable_kind === 'department'}
                          onClick={() => setLiableKind('department')}
                        >
                          <CubeCheck selected={form.liable_kind === 'department'} />
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
                            {invOptions.users.map((u) => {
                              const selected = form.liable_user_id === u.id;
                              return (
                                <button
                                  key={u.id}
                                  type="button"
                                  className={cubeClass(u.id, selected)}
                                  disabled={readOnly}
                                  aria-pressed={selected}
                                  onClick={() => setForm({ ...form, liable_user_id: u.id })}
                                >
                                  <CubeCheck selected={selected} />
                                  <span className="inv-dept-cube-name">{u.name}</span>
                                </button>
                              );
                            })}
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
                            {branchDepartments.map((d) => {
                              const selected = form.liable_department_id === d.id;
                              return (
                                <button
                                  key={d.id}
                                  type="button"
                                  className={cubeClass(d.id, selected)}
                                  disabled={readOnly}
                                  aria-pressed={selected}
                                  onClick={() => setForm({ ...form, liable_department_id: d.id })}
                                >
                                  <CubeCheck selected={selected} />
                                  <span className="inv-dept-cube-name">{d.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {form.inventory_coverage === 'full' && (form.remainder_document?.number || remainderItems.length > 0) && (
                  <div className="inv-remainder-note">
                    {form.remainder_document?.number ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        Списание непересчитанного · {formatMoney(totals.remainder)}
                        {' · '}
                        {remainderItems.length}
                        {' '}
                        {remainderItems.length === 1 ? 'позиция' : 'позиций'}
                      </>
                    )}
                    <button
                      type="button"
                      className="inv-remainder-note-link"
                      onClick={() => setSheetTab('items')}
                    >
                      Что спишется
                    </button>
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
                            <th className="inv-row-num">№</th>
                            <th>Товар</th>
                            <th className="doc-items-unit-col">Ед.</th>
                            <th className="doc-items-net-col">Нетто</th>
                            <th className="col-num">Учёт</th>
                            <th className="col-num">Факт</th>
                            <th className="col-num">Разница</th>
                            {showAmount && <th className="col-num inv-col-cost">Себест.</th>}
                            {showAmount && <th className="col-num inv-col-amount">Сумма</th>}
                            {!readOnly && <th />}
                          </tr>
                        </thead>
                        <tbody>
                          {visibleItems.length === 0 ? (
                            <tr>
                              <td colSpan={(showAmount ? 9 : 7) + (readOnly ? 0 : 1)} className="empty">
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
                            const cost = lineCost(item);
                            const unit = productUnit(products, item);
                            const diffClass = diff > 1e-9 ? 'inv-diff-pos' : diff < -1e-9 ? 'inv-diff-neg' : '';
                            const canEditCost = !readOnly && needsSurplusCost(item);
                            return (
                              <tr key={`${item.product_id}:${item.variant_id || ''}:${idx}`} className={diffClass ? 'inv-row-discrepancy' : undefined}>
                                <td className="inv-row-num">{idx + 1}</td>
                                <td>{productName(products, item)}</td>
                                <td className="doc-items-unit-col">
                                  <span className="doc-item-unit">{unit}</span>
                                </td>
                                <td className="doc-items-net-col">
                                  <InventoryNetField
                                    item={item}
                                    idx={idx}
                                    unit={unit}
                                    readOnly={readOnly}
                                    onNet={updateNet}
                                  />
                                </td>
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
                                {showAmount && (
                                  <td className="col-num inv-col-cost">
                                    {canEditCost ? (
                                      <input
                                        className="input-qty inv-cost-input"
                                        inputMode="decimal"
                                        value={item.unit_cost_input ?? (cost ? formatPriceInput(cost) : '')}
                                        onChange={(e) => updateCost(idx, e.target.value)}
                                        placeholder="0,00"
                                        title="Себестоимость излишка"
                                      />
                                    ) : (
                                      cost > 0 ? formatMoney(cost) : '—'
                                    )}
                                  </td>
                                )}
                                {showAmount && (
                                  <td className="col-num inv-col-amount">{formatMoney(amount)}</td>
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
                        num={idx + 1}
                        products={products}
                        readOnly={readOnly}
                        onFact={updateFact}
                        onNet={updateNet}
                        onCost={updateCost}
                        onRemove={removeItem}
                        compact={isPhone}
                        showAmount={showAmount}
                      />
                    ))}
                  </div>
                  <InventoryWriteoffBlock
                    items={visibleRemainderItems}
                    products={products}
                    showAmount={showAmount}
                    isPhone={isPhone}
                    confirmed={form.status === 'confirmed'}
                  />
                </div>

                <div className={`doc-modal-totals${showAmount ? '' : ' is-qty-only'}`}>
                  {showAmount ? (
                    <>
                      <div className="inv-col-amount">Остатки {formatMoney(totals.stock)}</div>
                      {form.inventory_coverage === 'full' && totals.remainder > 0 ? (
                        <button
                          type="button"
                          className="inv-totals-writeoff"
                          onClick={() => document.getElementById('inv-writeoff')?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest',
                          })}
                        >
                          Списание {formatMoney(totals.remainder)}
                        </button>
                      ) : null}
                      <div className="inv-diff-neg">− {formatMoney(totals.shortage)}</div>
                      <div className="inv-diff-pos">+ {formatMoney(totals.surplus)}</div>
                      <div className="doc-modal-total inv-col-amount">
                        <strong>Итого {formatMoney(totals.stockTotal)}</strong>
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
