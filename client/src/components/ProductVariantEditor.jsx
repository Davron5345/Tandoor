import { useEffect, useRef } from 'react';
import ProductMediaCubes, { revokePendingImages } from './ProductMediaCubes';
import { formatPriceInput, parsePriceInput } from '../api';

export function emptyVariant() {
  return {
    clientId: crypto.randomUUID(),
    id: null,
    name: '',
    price: '',
    stock: '',
    images: [],
  };
}

export function mapProductVariants(variants = []) {
  return variants.map((v) => ({
    clientId: v.id || crypto.randomUUID(),
    id: v.id || null,
    name: v.name || '',
    price: v.price != null && v.price !== '' ? formatPriceInput(v.price) : '',
    stock: v.stock != null && v.stock !== '' ? String(v.stock) : '',
    images: (v.images || []).map((img) => ({ ...img, is_primary: !!img.is_primary })),
  }));
}

export function revokeVariantImages(variants = []) {
  for (const variant of variants) {
    revokePendingImages(variant.images || []);
  }
}

export default function ProductVariantEditor({
  productId,
  variants,
  setVariants,
  canEdit,
  show,
  uploading,
  setUploading,
  focusVariantId = null,
}) {
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusVariantId) {
      focusedRef.current = false;
      return undefined;
    }
    const variant = variants.find((v) => v.id === focusVariantId);
    if (!variant) return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById(`product-variant-card-${variant.clientId}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, focusedRef.current ? 0 : 120);
    focusedRef.current = true;
    return () => window.clearTimeout(timer);
  }, [focusVariantId, variants]);
  const updateVariant = (clientId, patch) => {
    setVariants((prev) => prev.map((v) => (v.clientId === clientId ? { ...v, ...patch } : v)));
  };

  const setVariantImages = (clientId, nextImages) => {
    setVariants((prev) => prev.map((v) => (
      v.clientId === clientId ? { ...v, images: typeof nextImages === 'function' ? nextImages(v.images || []) : nextImages } : v
    )));
  };

  const addVariant = () => {
    setVariants((prev) => [...prev, emptyVariant()]);
  };

  const removeVariant = (clientId) => {
    setVariants((prev) => {
      const removed = prev.find((v) => v.clientId === clientId);
      revokePendingImages(removed?.images || []);
      return prev.filter((v) => v.clientId !== clientId);
    });
  };

  return (
    <div className="product-variants">
      {canEdit && (
        <div className="product-variant-add-bar">
          <button type="button" className="btn btn-ghost product-variant-add" onClick={addVariant}>
            + Добавить вариант
          </button>
        </div>
      )}

      <div className="product-variants-list">
        {variants.map((variant, index) => (
          <div
            key={variant.clientId}
            id={`product-variant-card-${variant.clientId}`}
            className={[
              'product-variant-card',
              focusVariantId && variant.id === focusVariantId ? 'product-variant-card-focused' : '',
            ].filter(Boolean).join(' ')}
          >
          <div className="product-variant-card-head">
            <span className="product-variant-card-title">Вариант {index + 1}</span>
            {canEdit && variants.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm product-variant-remove"
                onClick={() => removeVariant(variant.clientId)}
              >
                Удалить
              </button>
            )}
          </div>

          <div className="form-grid product-variant-fields">
            <div className="form-group">
              <label>Название *</label>
              <input
                value={variant.name}
                disabled={!canEdit}
                onChange={(e) => updateVariant(variant.clientId, { name: e.target.value })}
                placeholder="Например: Красный, XL"
              />
            </div>
            <div className="form-group">
              <label>Цена *</label>
              <input
                type="text"
                inputMode="numeric"
                disabled={!canEdit}
                value={variant.price}
                onChange={(e) => updateVariant(variant.clientId, {
                  price: formatPriceInput(e.target.value),
                })}
                placeholder="1 000 000"
              />
            </div>
            <div className="form-group">
              <label>Остаток</label>
              <input
                type="number"
                min="0"
                step="0.001"
                disabled={!canEdit}
                value={variant.stock}
                onChange={(e) => updateVariant(variant.clientId, { stock: e.target.value })}
                placeholder="0"
              />
            </div>
          </div>

          <ProductMediaCubes
            productId={productId}
            variantId={variant.id}
            images={variant.images || []}
            setImages={(next) => setVariantImages(variant.clientId, next)}
            canEdit={canEdit}
            uploading={uploading}
            setUploading={setUploading}
            show={show}
            collapsible
          />
        </div>
        ))}
      </div>
    </div>
  );
}

export function validateVariants(variants, show) {
  if (!variants.length) {
    show('Добавьте хотя бы один вариант', 'error');
    return false;
  }

  for (const variant of variants) {
    if (!variant.name.trim()) {
      show('Укажите название варианта', 'error');
      return false;
    }
    const price = parsePriceInput(variant.price);
    if (price == null || Number.isNaN(price)) {
      show(`Укажите цену варианта «${variant.name.trim() || 'без названия'}»`, 'error');
      return false;
    }
    if (price < 0) {
      show(`Цена варианта «${variant.name.trim()}» не может быть отрицательной`, 'error');
      return false;
    }
  }

  return true;
}

export function buildVariantsPayload(variants) {
  return variants.map((v, idx) => ({
    id: v.id || undefined,
    name: v.name.trim(),
    price: parsePriceInput(v.price),
    stock: v.stock === '' || v.stock == null ? 0 : Number(v.stock),
    sort_order: idx,
  }));
}
