export const PRODUCT_TABLE_COLUMNS_KEY = 'warehouse-products-table-columns';

export const PRODUCT_TABLE_COLUMNS = [
  { id: 'num', label: '№', locked: true, colClass: 'col-num', thClass: 'product-list-num-col' },
  { id: 'photo', label: 'Фото', colClass: 'col-photo', thClass: 'product-list-photo-col' },
  { id: 'name', label: 'Наименование', locked: true, colClass: 'col-name' },
  { id: 'kind', label: 'Вид', colClass: 'col-kind', sortKey: 'product_kind' },
  { id: 'category', label: 'Категория', colClass: 'col-category', sortKey: 'category_name' },
  { id: 'sku', label: 'Артикул', colClass: 'col-sku', sortKey: 'sku' },
  { id: 'unit', label: 'Ед.', colClass: 'col-unit', sortKey: 'unit', sortThClass: 'col-unit' },
  { id: 'net_weight', label: 'Нетто', colClass: 'col-weight', sortKey: 'net_weight', sortThClass: 'col-num' },
  { id: 'gross_weight', label: 'Брутто', colClass: 'col-weight', sortKey: 'gross_weight', sortThClass: 'col-num' },
  { id: 'price', label: 'Цена', colClass: 'col-price', sortKey: 'price', sortThClass: 'col-num' },
  { id: 'stock', label: 'Остаток', colClass: 'col-stock', sortKey: 'stock', sortThClass: 'col-num' },
  { id: 'suppliers', label: 'Поставщики', colClass: 'col-suppliers' },
  { id: 'shop', label: 'Магазин', colClass: 'col-shop', thClass: 'product-list-shop-col', shopOnly: true },
  { id: 'actions', label: 'Действия', locked: true, colClass: 'col-actions' },
];

const TOGGLEABLE_IDS = PRODUCT_TABLE_COLUMNS
  .filter((col) => !col.locked)
  .map((col) => col.id);

export const DEFAULT_VISIBLE_COLUMNS = [...TOGGLEABLE_IDS];

export function readProductTableColumns() {
  try {
    const raw = localStorage.getItem(PRODUCT_TABLE_COLUMNS_KEY);
    if (!raw) return new Set(DEFAULT_VISIBLE_COLUMNS);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_VISIBLE_COLUMNS);
    const valid = new Set(TOGGLEABLE_IDS);
    return new Set(parsed.filter((id) => valid.has(id)));
  } catch {
    return new Set(DEFAULT_VISIBLE_COLUMNS);
  }
}

export function writeProductTableColumns(visibleSet) {
  const stored = TOGGLEABLE_IDS.filter((id) => visibleSet.has(id));
  localStorage.setItem(PRODUCT_TABLE_COLUMNS_KEY, JSON.stringify(stored));
}

export function isProductColumnVisible(visibleSet, columnId, { showShopColumn = false } = {}) {
  const col = PRODUCT_TABLE_COLUMNS.find((c) => c.id === columnId);
  if (!col) return false;
  if (col.locked) return true;
  if (col.shopOnly && !showShopColumn) return false;
  return visibleSet.has(columnId);
}

export function getToggleableProductColumns({ showShopColumn = false } = {}) {
  return PRODUCT_TABLE_COLUMNS.filter((col) => {
    if (col.locked) return false;
    if (col.shopOnly && !showShopColumn) return false;
    return true;
  });
}
