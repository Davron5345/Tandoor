import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, formatPriceInput, parsePriceInput } from '../api';
import Modal, { ModalCancelButton, useToast } from './Modal';
import CategorySelectWithAdd from './CategorySelectWithAdd';
import ProductMediaCubes, { revokePendingImages, uploadPendingProductImages } from './ProductMediaCubes';
import ProductVariantEditor, {
  buildVariantsPayload,
  emptyVariant,
  mapProductVariants,
  validateVariants,
} from './ProductVariantEditor';
import SupplierMultiSelectWithAdd from './SupplierMultiSelectWithAdd';
import ProductBranchSettings, {
  mapBranchSettingsFromApi,
  serializeBranchSettingsForApi,
} from './ProductBranchSettings';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useFormDirty } from '../hooks/useFormDirty';
import { hasPermission } from '../permissions';
import {
  PRODUCT_KIND_GOODS,
  PRODUCT_KIND_LABELS,
  PRODUCT_KINDS,
} from '../productKinds';

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

/**
 * Штатное окно «Новый товар» / «Карточка товара» (как в справочнике номенклатуры).
 * create: productId не задан; edit: передать productId.
 */
export default function ProductCreateModal({
  open,
  onClose,
  onCreated,
  onSaved,
  productId = null,
  /** Уже известная карточка (из списка документа) — без полного getProducts */
  seedProduct = null,
  initialSupplierIds = [],
  initialTab = 'main',
}) {
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branches, isAdmin } = useBranch();
  const canEdit = hasPermission(user, 'products.edit');
  const canAddSupplier = hasPermission(user, 'counterparties.edit');
  const isEdit = Boolean(productId);

  const [categories, setCategories] = useState([]);
  const [units, setUnits] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(emptyProduct);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [productCardTab, setProductCardTab] = useState('main');
  const [branchSettings, setBranchSettings] = useState([]);
  const [focusedVariantId, setFocusedVariantId] = useState(null);
  const [archivedVariants, setArchivedVariants] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const draftPayload = useMemo(() => ({
    form,
    productCardTab,
    branchSettings: isAdmin ? branchSettings : [],
  }), [form, productCardTab, branchSettings, isAdmin]);
  const isFormDirty = useFormDirty(
    draftPayload,
    open ? (isEdit ? `product-edit-${productId}` : 'product-create-quick') : null,
  );

  const unitOptions = useMemo(
    () => [...units]
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'ru'))
      .map((u) => u.name),
    [units],
  );

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
      visible: true,
      price: '',
      variants: variantRows,
    }));
  }, [branches]);

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

  const refreshCategories = useCallback(async () => {
    try {
      const c = await api.getProductCategories();
      setCategories(c);
      return c;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, []);

  const clearImages = useCallback(() => {
    setImages((prev) => {
      revokePendingImages(prev);
      return [];
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const supplierSeed = Array.isArray(initialSupplierIds)
      ? initialSupplierIds.filter(Boolean)
      : [];
    const tab = initialTab || 'main';

    setLoading(true);
    Promise.all([
      api.getProductCategories(),
      api.getUnits(),
      api.getCounterparties('supplier'),
      isEdit && !(seedProduct && seedProduct.id === productId)
        ? api.getProducts({ admin_list: '1' })
        : Promise.resolve(null),
    ])
      .then(async ([cats, unitRows, supplierRows, productList]) => {
        if (cancelled) return;
        setCategories(cats);
        setUnits(unitRows);
        setSuppliers(supplierRows);

        if (isEdit) {
          let p = (seedProduct && seedProduct.id === productId) ? seedProduct : null;
          if (!p) {
            const list = Array.isArray(productList) ? productList : (productList?.items || []);
            p = list.find((row) => row.id === productId) || null;
          }
          if (!p) {
            show('Товар не найден', 'error');
            onClose?.();
            return;
          }
          const priceSource = isAdmin ? (p.base_price ?? p.price) : p.price;
          setForm({
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
          });
          setProductCardTab(tab);
          setFocusedVariantId(null);
          if (p.has_variants) {
            api.getArchivedProductVariants(p.id)
              .then((rows) => { if (!cancelled) setArchivedVariants(rows); })
              .catch(() => { if (!cancelled) setArchivedVariants([]); });
          } else {
            setArchivedVariants([]);
            api.getProductImages(p.id)
              .then((imgs) => { if (!cancelled) setImages(imgs || []); })
              .catch(() => { if (!cancelled) clearImages(); });
          }
          if (isAdmin) {
            try {
              const settings = await api.getProductBranchSettings(p.id);
              if (!cancelled) setBranchSettings(mapBranchSettingsFromApi(settings));
            } catch (e) {
              console.error(e);
              if (!cancelled) setBranchSettings(buildDefaultBranchSettings(p.variants || []));
            }
          } else {
            setBranchSettings([]);
          }
        } else {
          setForm({
            ...emptyProduct,
            category_id: cats[0]?.id || 'other',
            unit: unitRows[0]?.name || 'шт',
            supplier_ids: supplierSeed,
          });
          setProductCardTab(tab);
          setFocusedVariantId(null);
          setArchivedVariants([]);
          setBranchSettings(isAdmin ? buildDefaultBranchSettings() : []);
          clearImages();
        }
      })
      .catch((e) => {
        console.error(e);
        show(e.message || 'Не удалось открыть карточку товара', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Только при открытии — не сбрасывать форму при каждом рендере родителя
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  if (!open) return null;

  const close = () => {
    clearImages();
    setFocusedVariantId(null);
    setArchivedVariants([]);
    onClose?.();
  };

  const toggleVariants = (enabled) => {
    if (!enabled && form.variants.length > 0) {
      if (!window.confirm('Отключить варианты? Все варианты и их фото будут удалены при сохранении.')) {
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
      clearImages();
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

  const restoreVariant = async (variant) => {
    if (!productId) return;
    const label = variant.name || 'вариант';
    if (!window.confirm(`Вернуть вариант «${label}» в справочник?`)) return;
    try {
      const updated = await api.restoreProductVariant(productId, variant.id);
      show('Вариант восстановлен');
      setArchivedVariants(await api.getArchivedProductVariants(productId));
      setForm((prev) => ({
        ...prev,
        has_variants: true,
        variants: mapProductVariants(updated.variants || []),
      }));
    } catch (e) {
      show(e.message, 'error');
    }
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

    setSaving(true);
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

      if (isEdit) {
        const updated = await api.updateProduct(productId, payload);
        if (form.has_variants) {
          await uploadVariantPendingImages(updated.id, updated.variants || [], form.variants);
        } else {
          const hasPending = images.some((i) => i.pending);
          if (hasPending) {
            await uploadPendingProductImages(updated.id, images);
          }
        }
        show('Товар сохранён');
        onSaved?.(updated);
      } else {
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
        onCreated?.(created);
        onSaved?.(created);
      }
      close();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
      {Toast}
      <Modal
        wide
        className="modal-product"
        title={isEdit ? 'Карточка товара' : 'Новый товар'}
        dirty={isFormDirty}
        footerPlacement="end"
        onClose={close}
        footer={(
          <>
            <ModalCancelButton disabled={saving} />
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving || !canEdit || loading}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </>
        )}
      >
        {loading ? (
          <div className="empty" style={{ padding: 24 }}>Загрузка…</div>
        ) : (
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
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
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
                    <CategorySelectWithAdd
                      categories={categories}
                      value={form.category_id}
                      onChange={(category_id) => setForm({ ...form, category_id })}
                      selectedId={form.category_id}
                      canAdd={canEdit}
                      disabled={!canEdit}
                      onCategoryCreated={async () => {
                        await refreshCategories();
                        show('Категория добавлена');
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>Ед. изм. *</label>
                    <select
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      required
                    >
                      {unitOptions.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                      {form.unit && !unitOptions.includes(form.unit) && (
                        <option value={form.unit}>{form.unit}</option>
                      )}
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
                    <input
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    />
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
                    <SupplierMultiSelectWithAdd
                      suppliers={suppliers}
                      value={form.supplier_ids || []}
                      onChange={(supplier_ids) => setForm({ ...form, supplier_ids })}
                      onSupplierCreated={(created) => {
                        setSuppliers((prev) => [...prev, created]
                          .sort((a, b) => a.name.localeCompare(b.name, 'ru')));
                      }}
                      disabled={!canEdit}
                      canAdd={canAddSupplier}
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
                    onRestoreVariant={isEdit ? restoreVariant : undefined}
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
        )}
      </Modal>
    </>,
    document.body,
  );
}
