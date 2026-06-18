import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney, formatPriceInput, parsePriceInput } from '../api';
import Modal, { useToast } from '../components/Modal';
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
  getVariantDisplayName,
  getVariantPrimaryImage,
} from '../utils/productVariants';
import SupplierMultiSelect from '../components/SupplierMultiSelect';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';

const UNITS = ['шт', 'кг', 'г', 'л', 'мл', 'м', 'м²', 'м³', 'уп', 'пач', 'кор'];

const emptyProduct = {
  name: '',
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

function IconButton({ title, onClick, children, danger = false }) {
  return (
    <button
      type="button"
      className={`btn btn-icon btn-ghost btn-sm${danger ? ' btn-icon-danger' : ''}`}
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
        🖼
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

function ProductTable({ items, renderRow }) {
  if (items.length === 0) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="product-list-photo-col">Фото</th>
            <th>Наименование</th>
            <th>Категория</th>
            <th>Артикул</th>
            <th>Ед.</th>
            <th>Нетто</th>
            <th>Брутто</th>
            <th>Цена</th>
            <th>Остаток</th>
            <th>Поставщики</th>
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
  const [highlightedProductId, setHighlightedProductId] = useState(null);
  const [collapsedProductIds, setCollapsedProductIds] = useState(() => new Set());
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId } = useBranch();
  const canEdit = hasPermission(user, 'products.edit');

  const productId = modal && modal !== 'create' ? modal : null;

  const filterCategory = searchParams.get('category') || '';
  const filterSupplier = searchParams.get('supplier') || '';

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

  const load = () => {
    const params = {};
    if (filterCategory) params.category_id = filterCategory;
    if (filterSupplier) params.supplier_id = filterSupplier;
    return Promise.all([
      api.getProducts(params),
      api.getProductCategories(),
      api.getCounterparties('supplier'),
    ])
      .then(([p, c, s]) => {
        setProducts(p);
        setCategories(c);
        setSuppliers(s);
      })
      .catch(console.error);
  };

  useEffect(() => { load(); }, [branchId, filterCategory, filterSupplier]);

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

  const displayListRows = useMemo(() => {
    const rows = buildProductListRows(filteredProducts);
    if (!highlightedProductId) return rows;
    const highlightedIndex = rows.findIndex(
      (row) => row.product.id === highlightedProductId && row.kind === 'product',
    );
    if (highlightedIndex <= 0) return rows;
    const highlighted = rows[highlightedIndex];
    const related = rows.filter((row) => row.product.id === highlighted.product.id);
    const rest = rows.filter((row) => row.product.id !== highlighted.product.id);
    return [...related, ...rest];
  }, [filteredProducts, highlightedProductId]);

  const isSearching = search.trim().length > 0;

  const visibleListRows = useMemo(() => {
    if (isSearching) return displayListRows;
    return displayListRows.filter((row) => {
      if (row.kind !== 'variant') return true;
      return !collapsedProductIds.has(row.product.id);
    });
  }, [displayListRows, collapsedProductIds, isSearching]);

  const toggleProductVariants = (productId) => {
    setCollapsedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  useEffect(() => {
    if (!highlightedProductId) return;
    setCollapsedProductIds((prev) => {
      if (!prev.has(highlightedProductId)) return prev;
      const next = new Set(prev);
      next.delete(highlightedProductId);
      return next;
    });
  }, [highlightedProductId]);

  const openCreate = () => {
    clearImages();
    setForm({
      ...emptyProduct,
      category_id: filterCategory || categories[0]?.id || 'other',
      supplier_ids: [],
      variants: [],
    });
    setProductCardTab('main');
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
    setModal('create');
    show('Скопированы категория, ед. изм. и поставщики');
  };

  const openEdit = (p) => {
    setForm({
      name: p.name,
      category_id: p.category_id || 'other',
      unit: p.unit || 'шт',
      barcode: p.barcode || '',
      sku: p.sku || '',
      net_weight: p.net_weight ?? '',
      gross_weight: p.gross_weight ?? '',
      price: p.price != null && p.price !== '' ? formatPriceInput(p.price) : '',
      supplier_ids: (p.suppliers || []).map((s) => s.id),
      has_variants: !!p.has_variants,
      variants: p.has_variants ? mapProductVariants(p.variants || []) : [],
    });
    setProductCardTab('main');
    setModal(p.id);
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
    clearImages();
    setModal(null);
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
    if (!confirm('Удалить товар?')) return;
    try {
      await api.deleteProduct(id);
      show('Товар удалён');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const renderListRow = (row) => {
    const { product: p, variant, kind, rowKey } = row;
    const isVariant = kind === 'variant';
    const highlighted = p.id === highlightedProductId;
    const hasVariants = !isVariant && p.has_variants && (p.variants?.length > 0);
    const isCollapsed = hasVariants && collapsedProductIds.has(p.id);

    return (
      <tr
        key={rowKey}
        id={kind === 'product' ? `product-row-${p.id}` : undefined}
        className={[
          isVariant ? 'product-list-row-variant' : 'product-list-row-parent',
          hasVariants ? 'has-variants' : '',
          hasVariants && isCollapsed ? 'is-collapsed' : '',
          highlighted ? 'product-row-highlight' : '',
        ].filter(Boolean).join(' ')}
      >
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
                aria-expanded={!isCollapsed}
                title={isCollapsed ? 'Показать варианты' : 'Скрыть варианты'}
              >
                <span className="product-list-chevron" aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                <strong>{p.name}</strong>
                {isCollapsed && (
                  <span className="product-list-variant-count">{p.variants.length}</span>
                )}
              </button>
            ) : (
              <strong>{isVariant ? getVariantDisplayName(p, variant) : p.name}</strong>
            )}
          </div>
          {!isVariant && p.barcode && <div className="product-meta">Штрих-код: {p.barcode}</div>}
        </td>
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
        <td>
          {!isVariant && canEdit ? (
            <div className="btn-group btn-group-icons">
              <IconButton title="Изменить" onClick={() => openEdit(p)}>
                <IconEdit />
              </IconButton>
              <IconButton title="Копировать категорию, ед. изм. и поставщиков" onClick={() => copyFromProduct(p)}>
                <IconCopy />
              </IconButton>
              <IconButton title="Удалить" danger onClick={() => remove(p.id)}>
                <IconTrash />
              </IconButton>
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
        <h1>Товары</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>+ Добавить товар</button>
        )}
      </div>

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
          className="category-select-filter"
        />
        <CategorySelect
          categories={supplierOptions}
          value={filterSupplier}
          onChange={setFilterSupplier}
          tree={false}
          includeEmpty
          emptyLabel="Все поставщики"
          searchPlaceholder="Поиск поставщика..."
          className="category-select-filter"
        />
      </div>

      {visibleListRows.length === 0 ? (
        <div className="card"><div className="empty">Товары не найдены</div></div>
      ) : (
        <div className="card">
          <ProductTable items={visibleListRows} renderRow={renderListRow} />
        </div>
      )}

      {modal && (
        <Modal
          wide
          className="modal-product"
          title={modal === 'create' ? 'Новый товар' : 'Карточка товара'}
          onClose={() => { clearImages(); setHighlightedProductId(null); setModal(null); load(); }}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => { clearImages(); setModal(null); }}>Отмена</button>
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
                        <label>Цена *</label>
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
                    />
                  ) : (
                    <div className="product-variants-empty">
                      Включите переключатель, чтобы добавить варианты с отдельной ценой и медиа.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
