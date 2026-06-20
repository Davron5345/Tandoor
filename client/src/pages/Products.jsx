import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney, formatPriceInput, parsePriceInput } from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import CategorySelect from '../components/CategorySelect';
import ProductMediaCubes, { revokePendingImages, uploadPendingProductImages } from '../components/ProductMediaCubes';
import ProductVariantEditor, {
  buildVariantsPayload,
  emptyVariant,
  mapProductVariants,
  revokeVariantImages,
  validateVariants,
} from '../components/ProductVariantEditor';
import {
  buildProductListRows,
  buildProductRowNumbers,
  getVariantDisplayName,
  getVariantPrimaryImage,
} from '../utils/productVariants';
import SupplierMultiSelect from '../components/SupplierMultiSelect';
import ProductBranchSettings, {
  mapBranchSettingsFromApi,
  serializeBranchSettingsForApi,
} from '../components/ProductBranchSettings';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useFormDraft, formDraftKey, readFormDraft, clearFormDraft, promptRestoreDraft } from '../hooks/useFormDraft';
import { useFormDirty } from '../hooks/useFormDirty';
import { hasPermission } from '../permissions';
import { IconImage } from '../components/ActionIcons';
import {
  PRODUCT_KIND_GOODS,
  PRODUCT_KIND_LABELS,
  PRODUCT_KIND_LABELS_PLURAL,
  PRODUCT_KINDS,
  productKindLabel,
} from '../productKinds';

const UNITS = ['шт', 'кг', 'г', 'л', 'мл', 'м', 'м²', 'м³', 'уп', 'пач', 'кор'];

export const FILTER_NO_CATEGORY = '__no_category__';
export const FILTER_NO_SUPPLIER = '__no_supplier__';

const categoryFilterExtras = [{ id: FILTER_NO_CATEGORY, label: 'Без категории' }];
const supplierFilterExtras = [{ id: FILTER_NO_SUPPLIER, label: 'Без поставщиков' }];
const PRODUCT_PAGE_SIZE_KEY = 'warehouse-products-page-size';
const PRODUCT_PAGE_SIZE_OPTIONS = [15, 25, 50, 100];

function readProductPageSize() {
  try {
    const value = parseInt(localStorage.getItem(PRODUCT_PAGE_SIZE_KEY), 10);
    if (PRODUCT_PAGE_SIZE_OPTIONS.includes(value)) return value;
  } catch {
    /* ignore */
  }
  return 15;
}

function SortHeader({ label, sortKey, activeKey, direction, onSort, className = '' }) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`sortable-th ${className}${active ? ' is-sorted' : ''}`}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <div className="sortable-th-inner">
        <span className="sortable-th-label">{label}</span>
        <span className="sortable-th-icons" aria-hidden="true">
          <button
            type="button"
            className={`sort-arrow-btn up${active && direction === 'asc' ? ' active' : ''}`}
            aria-label={`${label}: по возрастанию`}
            onClick={() => onSort(sortKey, 'asc')}
          >
            ▲
          </button>
          <button
            type="button"
            className={`sort-arrow-btn down${active && direction === 'desc' ? ' active' : ''}`}
            aria-label={`${label}: по убыванию`}
            onClick={() => onSort(sortKey, 'desc')}
          >
            ▼
          </button>
        </span>
      </div>
    </th>
  );
}

function productPriceValue(product) {
  if (product.has_variants && product.variant_price_min != null) {
    return Number(product.variant_price_min);
  }
  return product.price != null && product.price !== '' ? Number(product.price) : null;
}

function compareProducts(a, b, sortKey, sortDir) {
  const dir = sortDir === 'asc' ? 1 : -1;
  const text = (value) => (value ?? '').toString().toLocaleLowerCase('ru');
  const number = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  };

  switch (sortKey) {
    case 'product_kind':
      return dir * text(a.product_kind_label || a.product_kind).localeCompare(
        text(b.product_kind_label || b.product_kind),
        'ru',
      );
    case 'category_name':
      return dir * text(a.category_name).localeCompare(text(b.category_name), 'ru');
    case 'sku':
      return dir * text(a.sku).localeCompare(text(b.sku), 'ru');
    case 'unit':
      return dir * text(a.unit).localeCompare(text(b.unit), 'ru');
    case 'net_weight':
    case 'gross_weight': {
      const av = number(a[sortKey]);
      const bv = number(b[sortKey]);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    }
    case 'price': {
      const av = productPriceValue(a);
      const bv = productPriceValue(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    }
    case 'stock': {
      const av = number(a.stock);
      const bv = number(b.stock);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * (av - bv);
    }
    case 'name':
    default:
      return dir * text(a.name).localeCompare(text(b.name), 'ru');
  }
}

const emptyProduct = {
  name: '',
  product_kind: PRODUCT_KIND_GOODS,
  category_id: 'other',
  unit: 'шт',
  barcode: '',
  sku: '',
  net_weight: '',
  gross_weight: '',
  price: '',
  supplier_ids: [],
  has_variants: false,
  variants: [],
};

function IconButton({ title, onClick, children, danger = false, success = false }) {
  return (
    <button
      type="button"
      className={`btn btn-icon btn-ghost btn-sm${danger ? ' btn-icon-danger' : ''}${success ? ' btn-icon-success' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13.5 6.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 7V5h6v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 7l1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M10 12h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconRestore() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7v6h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 17a9 9 0 0 0-15.8-6.3L3 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatProductPrice(product) {
  if (product.has_variants && product.variant_price_min != null) {
    if (product.variant_price_max != null && product.variant_price_max !== product.variant_price_min) {
      return `${formatMoney(product.variant_price_min)} – ${formatMoney(product.variant_price_max)}`;
    }
    return formatMoney(product.variant_price_min);
  }
  return formatMoney(product.price);
}

function formatWeight(value) {
  if (value == null || value === '') return '—';
  return `${value} кг`;
}

function formatCategory(product) {
  if (product.category_parent_id && product.parent_category_name) {
    return (
      <>
        <span>{product.category_name || '—'}</span>
        <div className="product-meta">{product.parent_category_name}</div>
      </>
    );
  }
  return product.category_name || 'Прочее';
}

function ProductListPhoto({ product, variant = null }) {
  const image = variant ? getVariantPrimaryImage(variant) : product.primary_image;
  const extraCount = variant ? 0 : (product.extra_image_count || 0);
  const imageCount = variant ? (variant.images?.length || 0) : (product.image_count || 0);

  if (!image) {
    return (
      <div className="product-list-thumb product-list-thumb-empty" title="Нет фото">
        <IconImage />
      </div>
    );
  }

  return (
    <div className="product-list-thumb-wrap" title={`${imageCount} файл(ов)`}>
      <img
        src={image.url}
        alt=""
        className="product-list-thumb"
        loading="lazy"
      />
      {image.media_type === 'gif' && (
        <span className="product-list-thumb-gif">GIF</span>
      )}
      {extraCount > 0 && (
        <span className="product-list-thumb-more">+{extraCount}</span>
      )}
    </div>
  );
}

function ProductTable({
  items,
  renderRow,
  showShopColumn = false,
  sortKey,
  sortDir,
  onSort,
}) {
  if (items.length === 0) return null;
  return (
    <div className="table-wrap products-table-scroll">
      <table className="products-table">
        <colgroup>
          <col className="col-num" />
          <col className="col-photo" />
          <col className="col-name" />
          <col className="col-kind" />
          <col className="col-category" />
          <col className="col-sku" />
          <col className="col-unit" />
          <col className="col-weight" />
          <col className="col-weight" />
          <col className="col-price" />
          <col className="col-stock" />
          <col className="col-suppliers" />
          {showShopColumn && <col className="col-shop" />}
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th className="product-list-num-col">№</th>
            <th className="product-list-photo-col">Фото</th>
            <SortHeader label="Наименование" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortHeader label="Вид" sortKey="product_kind" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortHeader label="Категория" sortKey="category_name" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortHeader label="Артикул" sortKey="sku" activeKey={sortKey} direction={sortDir} onSort={onSort} />
            <SortHeader label="Ед." sortKey="unit" activeKey={sortKey} direction={sortDir} onSort={onSort} className="col-unit" />
            <SortHeader label="Нетто" sortKey="net_weight" activeKey={sortKey} direction={sortDir} onSort={onSort} className="col-num" />
            <SortHeader label="Брутто" sortKey="gross_weight" activeKey={sortKey} direction={sortDir} onSort={onSort} className="col-num" />
            <SortHeader label="Цена" sortKey="price" activeKey={sortKey} direction={sortDir} onSort={onSort} className="col-num" />
            <SortHeader label="Остаток" sortKey="stock" activeKey={sortKey} direction={sortDir} onSort={onSort} className="col-num" />
            <th>Поставщики</th>
            {showShopColumn && <th className="product-list-shop-col">Магазин</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyProduct);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [productCardTab, setProductCardTab] = useState('main');
  const [focusedVariantId, setFocusedVariantId] = useState(null);
  const [highlightedProductId, setHighlightedProductId] = useState(null);
  const [expandedProductIds, setExpandedProductIds] = useState(() => new Set());
  const [productPage, setProductPage] = useState(1);
  const [productPages, setProductPages] = useState(1);
  const [productTotal, setProductTotal] = useState(0);
  const [productPageSize, setProductPageSize] = useState(readProductPageSize);
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [catalogCount, setCatalogCount] = useState(0);
  const [archiveCount, setArchiveCount] = useState(0);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId, branches, isAdmin } = useBranch();
  const canEdit = hasPermission(user, 'products.edit');
  const [branchSettings, setBranchSettings] = useState([]);
  const [listView, setListView] = useState('catalog');
  const [archivedVariants, setArchivedVariants] = useState([]);
  const [togglingShopVisible, setTogglingShopVisible] = useState(null);
  const showShopColumn = canEdit && listView === 'catalog';

  const productId = modal && modal !== 'create' ? modal : null;
  const draftKey = formDraftKey('products', modal);
  const draftPayload = useMemo(() => ({
    form,
    productCardTab,
    branchSettings: isAdmin ? branchSettings : [],
  }), [form, productCardTab, branchSettings, isAdmin]);
  useFormDraft(draftKey, draftPayload, Boolean(modal));
  const isFormDirty = useFormDirty(draftPayload, draftKey);

  const filterCategory = searchParams.get('category') || '';
  const filterSupplier = searchParams.get('supplier') || '';
  const filterKind = searchParams.get('kind') || '';

  const setFilterKind = (value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('kind', value);
      else next.delete('kind');
      return next;
    });
  };

  const setFilterCategory = (value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('category', value);
      else next.delete('category');
      return next;
    });
  };

  const setFilterSupplier = (value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('supplier', value);
      else next.delete('supplier');
      return next;
    });
  };

  const supplierOptions = useMemo(
    () => suppliers.map((s) => ({ id: s.id, name: s.name })),
    [suppliers],
  );

  const load = useCallback(() => {
    const params = { archived: listView === 'archive' ? '1' : '0', admin_list: '1' };
    if (filterCategory) params.category_id = filterCategory;
    if (filterSupplier) params.supplier_id = filterSupplier;
    if (filterKind) params.product_kind = filterKind;
    if (sortKey) {
      params.sort_by = sortKey;
      params.sort_dir = sortDir;
    }
    const searching = search.trim().length > 0;
    if (!searching) {
      params.page = productPage;
      params.limit = productPageSize;
    }
    const countParams = { page: 1, limit: 1, admin_list: '1' };
    if (filterCategory) countParams.category_id = filterCategory;
    if (filterSupplier) countParams.supplier_id = filterSupplier;

    return Promise.all([
      api.getProducts(params),
      api.getProducts({ ...countParams, archived: '0' }),
      api.getProducts({ ...countParams, archived: '1' }),
      api.getProductCategories(),
      api.getCounterparties('supplier'),
    ])
      .then(([p, catalogRes, archiveRes, c, s]) => {
        if (searching || Array.isArray(p)) {
          setProducts(Array.isArray(p) ? p : p.items || []);
          setProductPages(1);
          setProductTotal(Array.isArray(p) ? p.length : (p.items?.length ?? 0));
        } else {
          setProducts(p.items);
          setProductPages(p.pages);
          setProductTotal(p.total);
        }
        setCatalogCount(Array.isArray(catalogRes) ? catalogRes.length : (catalogRes.total ?? 0));
        setArchiveCount(Array.isArray(archiveRes) ? archiveRes.length : (archiveRes.total ?? 0));
        setCategories(c);
        setSuppliers(s);
      })
      .catch(console.error);
  }, [filterCategory, filterSupplier, filterKind, productPage, productPageSize, sortKey, sortDir, search, listView, branchId]);

  useEffect(() => {
    setProductPage(1);
  }, [branchId, filterCategory, filterSupplier, filterKind, search, listView, productPageSize]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId], { enabled: !modal });

  useEffect(() => {
    setHighlightedProductId(null);
  }, [branchId, filterCategory, filterSupplier, search]);

  useEffect(() => {
    if (!highlightedProductId) return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById(`product-row-${highlightedProductId}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [highlightedProductId, products]);

  useEffect(() => {
    if (!productId || form.has_variants) return;
    api.getProductImages(productId).then(setImages).catch(console.error);
  }, [productId, form.has_variants]);

  const clearImages = () => {
    setImages((prev) => {
      revokePendingImages(prev);
      return [];
    });
    setForm((prev) => {
      if (!prev.has_variants) return prev;
      revokeVariantImages(prev.variants);
      return { ...prev, variants: [] };
    });
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const productHay = [
        p.name,
        p.barcode,
        p.sku,
      ].filter(Boolean).join(' ').toLowerCase();
      if (productHay.includes(q)) return true;
      if (p.has_variants) {
        return (p.variants || []).some((v) => `${p.name} ${v.name}`.toLowerCase().includes(q));
      }
      return false;
    });
  }, [products, search]);

  const isSearching = search.trim().length > 0;

  const sortedProducts = useMemo(() => {
    if (!sortKey) return filteredProducts;
    const list = [...filteredProducts];
    list.sort((a, b) => compareProducts(a, b, sortKey, sortDir));
    return list;
  }, [filteredProducts, sortKey, sortDir]);

  const displayListRows = useMemo(() => {
    let rows = buildProductListRows(sortedProducts);
    if (listView === 'archive') {
      rows = rows.filter((row) => row.kind === 'product');
    }
    if (!highlightedProductId || sortKey) return rows;
    const highlightedIndex = rows.findIndex(
      (row) => row.product.id === highlightedProductId && row.kind === 'product',
    );
    if (highlightedIndex <= 0) return rows;
    const highlighted = rows[highlightedIndex];
    const related = rows.filter((row) => row.product.id === highlighted.product.id);
    const rest = rows.filter((row) => row.product.id !== highlighted.product.id);
    return [...related, ...rest];
  }, [sortedProducts, highlightedProductId, listView, sortKey]);

  const visibleListRows = useMemo(() => {
    if (isSearching) return displayListRows;
    return displayListRows.filter((row) => {
      if (row.kind !== 'variant') return true;
      return expandedProductIds.has(row.product.id);
    });
  }, [displayListRows, expandedProductIds, isSearching]);

  const rowNumbers = useMemo(() => {
    const startIndex = isSearching ? 0 : (productPage - 1) * productPageSize;
    return buildProductRowNumbers(visibleListRows, startIndex);
  }, [visibleListRows, isSearching, productPage, productPageSize]);

  const handleSort = (key, direction) => {
    setSortKey(key);
    setSortDir(direction);
    setProductPage(1);
  };

  const handlePageSizeChange = (event) => {
    const nextSize = parseInt(event.target.value, 10);
    if (!PRODUCT_PAGE_SIZE_OPTIONS.includes(nextSize)) return;
    setProductPageSize(nextSize);
    try {
      localStorage.setItem(PRODUCT_PAGE_SIZE_KEY, String(nextSize));
    } catch {
      /* ignore */
    }
  };

  const toggleProductVariants = (productId) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  useEffect(() => {
    if (!highlightedProductId) return;
    setExpandedProductIds((prev) => {
      if (prev.has(highlightedProductId)) return prev;
      const next = new Set(prev);
      next.add(highlightedProductId);
      return next;
    });
  }, [highlightedProductId]);

  const buildDefaultBranchSettings = useCallback((variants = []) => {
    const variantRows = variants
      .filter((v) => v.id)
      .map((v) => ({
        variant_id: v.id,
        name: v.name,
        base_price: parsePriceInput(v.price),
        price: '',
      }));
    return branches.map((b) => ({
      branch_id: b.id,
      branch_name: b.name,
      branch_active: !!b.active,
      visible: b.id === branchId,
      price: '',
      variants: variantRows,
    }));
  }, [branches, branchId]);

  const syncBranchSettingsVariants = useCallback((settings, variants) => {
    const variantRows = variants
      .filter((v) => v.id)
      .map((v) => ({
        variant_id: v.id,
        name: v.name,
        base_price: parsePriceInput(v.price),
      }));
    return settings.map((row) => ({
      ...row,
      variants: variantRows.map((variant) => {
        const existing = row.variants?.find((v) => v.variant_id === variant.variant_id);
        return {
          ...variant,
          price: existing?.price ?? '',
        };
      }),
    }));
  }, []);

  const openCreate = () => {
    clearImages();
    const key = formDraftKey('products', 'create');
    const draft = readFormDraft(key);
    let nextForm = {
      ...emptyProduct,
      product_kind: filterKind || PRODUCT_KIND_GOODS,
      category_id: (filterCategory && filterCategory !== FILTER_NO_CATEGORY)
        ? filterCategory
        : (categories[0]?.id || 'other'),
      supplier_ids: [],
      variants: [],
    };
    let tab = 'main';
    let settings = isAdmin ? buildDefaultBranchSettings() : [];
    if (draft && promptRestoreDraft(draft, 'черновик нового товара')) {
      nextForm = draft.form || nextForm;
      tab = draft.productCardTab || 'main';
      settings = draft.branchSettings || settings;
    } else if (draft) {
      clearFormDraft(key);
    }
    setForm(nextForm);
    setBranchSettings(settings);
    setProductCardTab(tab);
    setFocusedVariantId(null);
    setArchivedVariants([]);
    setModal('create');
  };

  const copyFromProduct = (p) => {
    clearImages();
    setForm({
      ...emptyProduct,
      category_id: p.category_id || 'other',
      unit: p.unit || 'шт',
      supplier_ids: (p.suppliers || []).map((s) => s.id),
    });
    setProductCardTab('main');
    setFocusedVariantId(null);
    setArchivedVariants([]);
    setModal('create');
    show('Скопированы категория, ед. изм. и поставщики');
  };

  const openEdit = async (p, options = {}) => {
    const { variantId = null } = options;
    const priceSource = isAdmin ? (p.base_price ?? p.price) : p.price;
    const baseForm = {
      name: p.name,
      product_kind: p.product_kind || PRODUCT_KIND_GOODS,
      category_id: p.category_id || 'other',
      unit: p.unit || 'шт',
      barcode: p.barcode || '',
      sku: p.sku || '',
      net_weight: p.net_weight ?? '',
      gross_weight: p.gross_weight ?? '',
      price: priceSource != null && priceSource !== '' ? formatPriceInput(priceSource) : '',
      supplier_ids: (p.suppliers || []).map((s) => s.id),
      has_variants: !!p.has_variants,
      variants: p.has_variants ? mapProductVariants(p.variants || []) : [],
    };
    const key = formDraftKey('products', p.id);
    const draft = readFormDraft(key);
    let restoredFromDraft = false;
    if (draft && promptRestoreDraft(draft, 'черновик товара')) {
      restoredFromDraft = true;
      setForm(draft.form || baseForm);
      setProductCardTab(draft.productCardTab || (variantId ? 'variants' : 'main'));
      if (draft.branchSettings?.length) setBranchSettings(draft.branchSettings);
    } else {
      if (draft) clearFormDraft(key);
      setForm(baseForm);
      setProductCardTab(variantId ? 'variants' : 'main');
    }
    setFocusedVariantId(variantId);
    setArchivedVariants([]);
    setModal(p.id);
    if (p.has_variants) {
      api.getArchivedProductVariants(p.id)
        .then(setArchivedVariants)
        .catch(() => setArchivedVariants([]));
    }
    if (isAdmin && !(restoredFromDraft && draft?.branchSettings?.length)) {
      try {
        const settings = await api.getProductBranchSettings(p.id);
        setBranchSettings(mapBranchSettingsFromApi(settings));
      } catch (e) {
        console.error(e);
        setBranchSettings(buildDefaultBranchSettings(p.variants || []));
      }
    } else {
      setBranchSettings([]);
    }
  };

  const toggleVariants = (enabled) => {
    if (!enabled && form.variants.length > 0) {
      if (!confirm('Отключить варианты? Все варианты и их фото будут удалены при сохранении.')) {
        return;
      }
    }
    setForm((prev) => ({
      ...prev,
      has_variants: enabled,
      variants: enabled
        ? (prev.variants.length ? prev.variants : [emptyVariant()])
        : [],
    }));
    if (enabled) {
      setProductCardTab('variants');
      setImages((prev) => {
        revokePendingImages(prev);
        return [];
      });
    }
  };

  const uploadVariantPendingImages = async (productIdValue, savedVariants, formVariants) => {
    for (let i = 0; i < formVariants.length; i += 1) {
      const formVariant = formVariants[i];
      const savedVariant = savedVariants[i];
      if (!savedVariant?.id) continue;
      const hasPending = (formVariant.images || []).some((img) => img.pending);
      if (hasPending) {
        await uploadPendingProductImages(productIdValue, formVariant.images, savedVariant.id);
      }
    }
  };

  const finishSave = async (savedId) => {
    clearFormDraft(draftKey);
    clearImages();
    setModal(null);
    setFocusedVariantId(null);
    setArchivedVariants([]);
    setHighlightedProductId(savedId);
    await load();
  };

  const save = async () => {
    if (!form.name.trim()) {
      show('Укажите наименование товара', 'error');
      return;
    }
    if (!form.category_id) {
      show('Выберите категорию', 'error');
      return;
    }
    if (!form.unit) {
      show('Выберите единицу измерения', 'error');
      return;
    }

    let price = null;
    if (!form.has_variants) {
      price = parsePriceInput(form.price);
      if (price == null || Number.isNaN(price)) {
        show('Укажите цену', 'error');
        return;
      }
      if (price < 0) {
        show('Цена не может быть отрицательной', 'error');
        return;
      }
    } else if (!validateVariants(form.variants, show)) {
      setProductCardTab('variants');
      return;
    }

    try {
      const payload = {
        name: form.name,
        product_kind: form.product_kind || PRODUCT_KIND_GOODS,
        category_id: form.category_id,
        unit: form.unit,
        barcode: form.barcode,
        sku: form.sku,
        net_weight: form.net_weight === '' ? null : form.net_weight,
        gross_weight: form.gross_weight === '' ? null : form.gross_weight,
        supplier_ids: form.supplier_ids || [],
        has_variants: !!form.has_variants,
        variants: form.has_variants ? buildVariantsPayload(form.variants) : [],
      };
      if (!form.has_variants) {
        payload.price = price;
      }
      if (isAdmin && branchSettings.length) {
        const synced = form.has_variants
          ? syncBranchSettingsVariants(branchSettings, buildVariantsPayload(form.variants))
          : branchSettings;
        payload.branch_settings = serializeBranchSettingsForApi(synced);
      }

      if (modal === 'create') {
        const created = await api.createProduct(payload);
        if (form.has_variants) {
          await uploadVariantPendingImages(created.id, created.variants || [], form.variants);
          show('Товар с вариантами сохранён');
        } else {
          const hasPending = images.some((i) => i.pending);
          if (hasPending) {
            await uploadPendingProductImages(created.id, images);
          }
          show(hasPending ? 'Товар и медиа сохранены' : 'Товар сохранён');
        }
        await finishSave(created.id);
      } else {
        const updated = await api.updateProduct(modal, payload);
        if (form.has_variants) {
          await uploadVariantPendingImages(updated.id, updated.variants || [], form.variants);
        }
        show('Товар сохранён');
        await finishSave(modal);
      }
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Удалить товар безвозвратно?')) return;
    try {
      await api.deleteProduct(id);
      show('Товар удалён');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const archiveProduct = async (product) => {
    const label = product.name;
    const msg = product.is_used
      ? `Отправить товар «${label}» в архив? Он скроется из справочника, но останется в истории документов.`
      : `Отправить товар «${label}» в архив?`;
    if (!confirm(msg)) return;
    try {
      await api.archiveProduct(product.id);
      show('Товар отправлен в архив');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const restoreProduct = async (product) => {
    if (!confirm(`Вернуть товар «${product.name}» в основной справочник?`)) return;
    try {
      await api.restoreProduct(product.id);
      show('Товар восстановлен');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const restoreVariant = async (product, variant) => {
    const label = getVariantDisplayName(product, variant);
    if (!confirm(`Вернуть вариант «${label}» в справочник?`)) return;
    try {
      const updated = await api.restoreProductVariant(product.id, variant.id);
      show('Вариант восстановлен');
      setArchivedVariants(await api.getArchivedProductVariants(product.id));
      if (modal === product.id) {
        setForm((prev) => ({
          ...prev,
          variants: mapProductVariants(updated.variants || []),
        }));
      }
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const archiveVariant = async (product, variant) => {
    const label = getVariantDisplayName(product, variant);
    if (!confirm(`Архивировать вариант «${label}»? Он скроется из списка и выбора товаров.`)) return;
    try {
      await api.archiveProductVariant(product.id, variant.id);
      show('Вариант отправлен в архив');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const toggleShopVisible = async (product, visible) => {
    setTogglingShopVisible(product.id);
    setProducts((prev) => prev.map((row) => (
      row.id === product.id ? { ...row, shop_visible: visible } : row
    )));
    try {
      await api.setProductShopVisible(product.id, visible);
      show(visible ? 'Товар показан в магазине' : 'Товар скрыт из магазина');
    } catch (e) {
      setProducts((prev) => prev.map((row) => (
        row.id === product.id ? { ...row, shop_visible: !visible } : row
      )));
      show(e.message, 'error');
    } finally {
      setTogglingShopVisible(null);
    }
  };

  const renderListRow = (row) => {
    const { product: p, variant, kind, rowKey } = row;
    const isVariant = kind === 'variant';
    const rowNumber = rowNumbers.get(rowKey) || '';
    const highlighted = p.id === highlightedProductId;
    const hasVariants = !isVariant && p.has_variants && (p.variants?.length > 0);
    const isExpanded = hasVariants && expandedProductIds.has(p.id);

    return (
      <tr
        key={rowKey}
        id={kind === 'product' ? `product-row-${p.id}` : undefined}
        className={[
          isVariant ? 'product-list-row-variant' : 'product-list-row-parent',
          hasVariants ? 'has-variants' : '',
          hasVariants && !isExpanded ? 'is-collapsed' : '',
          highlighted ? 'product-row-highlight' : '',
        ].filter(Boolean).join(' ')}
      >
        <td className="product-list-num-col">
          <span className={`product-list-num${isVariant ? ' product-list-num-variant' : ''}`}>
            {rowNumber}
          </span>
        </td>
        <td className="product-list-photo-col">
          <ProductListPhoto product={p} variant={variant} />
        </td>
        <td>
          <div className="product-list-name">
            {hasVariants ? (
              <button
                type="button"
                className="product-list-name-toggle"
                onClick={() => toggleProductVariants(p.id)}
                aria-expanded={isExpanded}
                title={isExpanded ? 'Скрыть варианты' : 'Показать варианты'}
              >
                <span className="product-list-chevron" aria-hidden>{isExpanded ? '▾' : '▸'}</span>
                <strong>{p.name}</strong>
                {!isExpanded && (
                  <span className="product-list-variant-count">{p.variants.length}</span>
                )}
              </button>
            ) : (
              <strong>{isVariant ? getVariantDisplayName(p, variant) : p.name}</strong>
            )}
          </div>
          {!isVariant && p.barcode && <div className="product-meta">Штрих-код: {p.barcode}</div>}
        </td>
        <td>{isVariant ? '—' : (p.product_kind_label || productKindLabel(p.product_kind))}</td>
        <td>{isVariant ? '—' : formatCategory(p)}</td>
        <td>{isVariant ? '—' : (p.sku || '—')}</td>
        <td>{p.unit}</td>
        <td>{isVariant ? '—' : formatWeight(p.net_weight)}</td>
        <td>{isVariant ? '—' : formatWeight(p.gross_weight)}</td>
        <td>{isVariant ? formatMoney(variant.price) : formatProductPrice(p)}</td>
        <td>{isVariant ? (variant.stock ?? 0) : p.stock}</td>
        <td>
          {isVariant ? (
            <span className="product-meta">—</span>
          ) : p.suppliers?.length > 0 ? (
            <div className="supplier-tags">
              {p.suppliers.map((s) => (
                <span key={s.id} className="supplier-tag">{s.name}</span>
              ))}
            </div>
          ) : (
            <span className="product-meta">—</span>
          )}
        </td>
        {showShopColumn && (
          <td className="product-list-shop-col">
            {!isVariant && canEdit ? (
              <label
                className="shop-visible-toggle"
                title={p.shop_visible ? 'Показывается в магазине' : 'Скрыт из магазина'}
              >
                <input
                  type="checkbox"
                  checked={!!p.shop_visible}
                  disabled={togglingShopVisible === p.id}
                  onChange={(e) => toggleShopVisible(p, e.target.checked)}
                />
                <span className="shop-visible-toggle-ui" aria-hidden />
              </label>
            ) : (
              <span className="product-meta">—</span>
            )}
          </td>
        )}
        <td>
          {canEdit && isVariant && listView === 'catalog' ? (
            <div className="btn-group btn-group-icons">
              <IconButton title="Изменить" onClick={() => openEdit(p, { variantId: variant.id })}>
                <IconEdit />
              </IconButton>
              <IconButton title="Архивировать" onClick={() => archiveVariant(p, variant)}>
                <IconArchive />
              </IconButton>
            </div>
          ) : canEdit && !isVariant && listView === 'archive' ? (
            <div className="btn-group btn-group-icons">
              <IconButton title="Вернуть в справочник" success onClick={() => restoreProduct(p)}>
                <IconRestore />
              </IconButton>
            </div>
          ) : !isVariant && canEdit && listView === 'catalog' ? (
            <div className="btn-group btn-group-icons">
              <IconButton title="Изменить" onClick={() => openEdit(p)}>
                <IconEdit />
              </IconButton>
              <IconButton title="Копировать категорию, ед. изм. и поставщиков" onClick={() => copyFromProduct(p)}>
                <IconCopy />
              </IconButton>
              <IconButton title="Архивировать" onClick={() => archiveProduct(p)}>
                <IconArchive />
              </IconButton>
              {!p.is_used && (
                <IconButton title="Удалить безвозвратно" danger onClick={() => remove(p.id)}>
                  <IconTrash />
                </IconButton>
              )}
            </div>
          ) : '—'}
        </td>
      </tr>
    );
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <div>
          <h1>Номенклатура</h1>
          <p className="page-subtitle">Товары, сырьё, полуфабрикаты и готовые блюда</p>
        </div>
        {canEdit && listView === 'catalog' && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>+ Добавить</button>
        )}
      </div>

      <div className="tabs products-kind-tabs">
        <button
          type="button"
          className={`tab${!filterKind ? ' active' : ''}`}
          onClick={() => setFilterKind('')}
        >
          Все
        </button>
        {PRODUCT_KINDS.map((kindId) => (
          <button
            key={kindId}
            type="button"
            className={`tab${filterKind === kindId ? ' active' : ''}`}
            onClick={() => setFilterKind(kindId)}
          >
            {PRODUCT_KIND_LABELS_PLURAL[kindId]}
          </button>
        ))}
      </div>

      <div className="tabs products-list-tabs">
        <button
          type="button"
          className={`tab${listView === 'catalog' ? ' active' : ''}`}
          onClick={() => setListView('catalog')}
        >
          Справочник
          <span className="tab-count">{catalogCount}</span>
        </button>
        <button
          type="button"
          className={`tab${listView === 'archive' ? ' active' : ''}`}
          onClick={() => setListView('archive')}
        >
          Архив
          <span className="tab-count">{archiveCount}</span>
        </button>
      </div>

      {listView === 'archive' && (
        <p className="products-archive-hint">
          Здесь товары, которые убрали из справочника. Их можно вернуть обратно. Товары из документов удалить нельзя — только архивировать.
        </p>
      )}

      <div className="filters">
        <input
          type="search"
          placeholder="Поиск по названию, штрих-коду, артикулу..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CategorySelect
          categories={categories}
          value={filterCategory}
          onChange={setFilterCategory}
          includeEmpty
          emptyLabel="Все категории"
          extraOptions={categoryFilterExtras}
          className="category-select-filter"
        />
        <CategorySelect
          categories={supplierOptions}
          value={filterSupplier}
          onChange={setFilterSupplier}
          tree={false}
          includeEmpty
          emptyLabel="Все поставщики"
          extraOptions={supplierFilterExtras}
          searchPlaceholder="Поиск поставщика..."
          className="category-select-filter"
        />
      </div>

      {visibleListRows.length === 0 ? (
        <div className="card">
          <div className="empty">
            {listView === 'archive' ? 'В архиве пока нет товаров' : 'Товары не найдены'}
          </div>
        </div>
      ) : (
        <div
          className="card products-table-card"
          style={{ '--products-visible-rows': productPageSize }}
        >
          <ProductTable
            items={visibleListRows}
            renderRow={renderListRow}
            showShopColumn={showShopColumn}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
          />
          {!isSearching && productTotal > 0 && (
            <div className="products-table-footer">
              <label className="products-page-size">
                <span>На странице</span>
                <select value={productPageSize} onChange={handlePageSizeChange}>
                  {PRODUCT_PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
              <div className="products-pagination">
                <span className="products-pagination-meta">
                  {productTotal} товаров · стр. {productPage} из {productPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={productPage <= 1}
                  onClick={() => setProductPage((p) => p - 1)}
                >
                  ← Назад
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={productPage >= productPages}
                  onClick={() => setProductPage((p) => p + 1)}
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {modal && (
        <Modal
          wide
          className="modal-product"
          title={modal === 'create' ? 'Новый товар' : 'Карточка товара'}
          dirty={isFormDirty}
          onClose={() => {
            clearFormDraft(draftKey);
            clearImages();
            setHighlightedProductId(null);
            setFocusedVariantId(null);
            setModal(null);
            load();
          }}
          footer={
            <>
              <ModalCancelButton />
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="product-card-tabs">
            <div className="tabs">
              <button
                type="button"
                className={`tab${productCardTab === 'main' ? ' active' : ''}`}
                onClick={() => setProductCardTab('main')}
              >
                Основное
              </button>
              <button
                type="button"
                className={`tab${productCardTab === 'extra' ? ' active' : ''}`}
                onClick={() => setProductCardTab('extra')}
              >
                Доп. инфо
              </button>
              <button
                type="button"
                className={`tab${productCardTab === 'variants' ? ' active' : ''}`}
                onClick={() => setProductCardTab('variants')}
              >
                Варианты
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className={`tab${productCardTab === 'branches' ? ' active' : ''}`}
                  onClick={() => {
                    if (form.has_variants) {
                      setBranchSettings((prev) => syncBranchSettingsVariants(
                        prev,
                        buildVariantsPayload(form.variants),
                      ));
                    }
                    setProductCardTab('branches');
                  }}
                >
                  Филиалы
                </button>
              )}
            </div>

            <div className="product-card-tab-panels">
              <div className={`product-card-tab-panel${productCardTab === 'main' ? ' active' : ''}`}>
                <div className="form-section">
                  <h3 className="form-section-title">Основное</h3>
                  <div className="form-grid">
                    <div className="form-group full">
                      <label>Наименование *</label>
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Вид номенклатуры *</label>
                      <select
                        value={form.product_kind || PRODUCT_KIND_GOODS}
                        onChange={(e) => setForm({ ...form, product_kind: e.target.value })}
                      >
                        {PRODUCT_KINDS.map((kindId) => (
                          <option key={kindId} value={kindId}>{PRODUCT_KIND_LABELS[kindId]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Категория *</label>
                      <CategorySelect
                        categories={categories}
                        value={form.category_id}
                        onChange={(category_id) => setForm({ ...form, category_id })}
                        selectedId={form.category_id}
                      />
                    </div>
                    <div className="form-group">
                      <label>Ед. изм. *</label>
                      <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required>
                        {UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    {!form.has_variants && (
                      <div className="form-group">
                        <label>{isAdmin ? 'Базовая цена *' : 'Цена *'}</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          required
                          value={form.price}
                          onChange={(e) => setForm({
                            ...form,
                            price: formatPriceInput(e.target.value),
                          })}
                          placeholder="1 000 000"
                        />
                      </div>
                    )}
                    {form.has_variants && (
                      <div className="form-group full">
                        <p className="product-variants-main-note">
                          Цена и фото задаются во вкладке «Варианты».
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {!form.has_variants && (
                  <div className="form-section">
                    <h3 className="form-section-title">Фото</h3>
                    <ProductMediaCubes
                      productId={productId}
                      images={images}
                      setImages={setImages}
                      canEdit={canEdit}
                      uploading={uploading}
                      setUploading={setUploading}
                      show={show}
                    />
                  </div>
                )}
              </div>

              <div className={`product-card-tab-panel${productCardTab === 'extra' ? ' active' : ''}`}>
                <div className="form-section">
                  <h3 className="form-section-title">Доп. инфо</h3>
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Штрих-код</label>
                      <input
                        value={form.barcode}
                        onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                        placeholder="EAN-13, Code128..."
                      />
                    </div>
                    <div className="form-group">
                      <label>Артикул</label>
                      <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Нетто, кг</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.net_weight}
                        onChange={(e) => setForm({ ...form, net_weight: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Брутто, кг</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={form.gross_weight}
                        onChange={(e) => setForm({ ...form, gross_weight: e.target.value })}
                      />
                    </div>
                    <div className="form-group full">
                      <label>Поставщики (можно выбрать несколько)</label>
                      <SupplierMultiSelect
                        suppliers={suppliers}
                        value={form.supplier_ids || []}
                        onChange={(supplier_ids) => setForm({ ...form, supplier_ids })}
                        disabled={!canEdit}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className={`product-card-tab-panel${productCardTab === 'variants' ? ' active' : ''}`}>
                <div className="form-section product-variants-panel">
                  <div className="product-variants-panel-head">
                    <div>
                      <h3 className="form-section-title">Варианты товара</h3>
                      <p className="product-variants-hint">
                        У каждого варианта своё название, фото, GIF и цена. Остаток учитывается по товару в целом.
                      </p>
                    </div>
                    <label className="product-variants-toggle">
                      <input
                        type="checkbox"
                        checked={!!form.has_variants}
                        disabled={!canEdit}
                        onChange={(e) => toggleVariants(e.target.checked)}
                      />
                      <span>Включить</span>
                    </label>
                  </div>

                  {form.has_variants ? (
                    <ProductVariantEditor
                      productId={productId}
                      variants={form.variants}
                      setVariants={(variants) => setForm((prev) => ({
                        ...prev,
                        variants: typeof variants === 'function' ? variants(prev.variants) : variants,
                      }))}
                      canEdit={canEdit}
                      show={show}
                      uploading={uploading}
                      setUploading={setUploading}
                      focusVariantId={focusedVariantId}
                      archivedVariants={archivedVariants}
                      onRestoreVariant={(variant) => restoreVariant({ id: productId, name: form.name }, variant)}
                    />
                  ) : (
                    <div className="product-variants-empty">
                      Включите переключатель, чтобы добавить варианты с отдельной ценой и медиа.
                    </div>
                  )}
                </div>
              </div>

              {isAdmin && (
                <div className={`product-card-tab-panel${productCardTab === 'branches' ? ' active' : ''}`}>
                  <div className="form-section">
                    <h3 className="form-section-title">Филиалы</h3>
                    <ProductBranchSettings
                      settings={branchSettings}
                      setSettings={setBranchSettings}
                      hasVariants={!!form.has_variants}
                      basePrice={form.has_variants
                        ? null
                        : (parsePriceInput(form.price) ?? '—')}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
