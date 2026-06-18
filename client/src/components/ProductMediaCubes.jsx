import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

export const MAX_PHOTOS = 5;
export const MAX_GIFS = 2;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

function createPendingImage(file, images) {
  const isGif = file.type === 'image/gif';
  const mediaType = isGif ? 'gif' : 'photo';
  const hasPrimaryPhoto = images.some((i) => i.media_type === 'photo' && i.is_primary);

  return {
    id: `pending-${crypto.randomUUID()}`,
    pending: true,
    file,
    url: URL.createObjectURL(file),
    media_type: mediaType,
    is_primary: mediaType === 'photo' && !hasPrimaryPhoto && !images.some((i) => i.media_type === 'photo'),
    original_name: file.name,
    sort_order: Date.now(),
  };
}

export function revokePendingImages(images = []) {
  for (const image of images) {
    if (image.pending && image.url?.startsWith('blob:')) {
      URL.revokeObjectURL(image.url);
    }
  }
}

export async function uploadPendingProductImages(productId, images, variantId = null) {
  const pending = images.filter((i) => i.pending && i.file);
  if (pending.length === 0) return images.filter((i) => !i.pending);

  const pendingPhotos = pending.filter((i) => i.media_type === 'photo');
  const pendingGifs = pending.filter((i) => i.media_type === 'gif');
  const primaryPhoto = pendingPhotos.find((i) => i.is_primary) || pendingPhotos[0];
  const otherPhotos = pendingPhotos.filter((i) => i.id !== primaryPhoto?.id);
  const uploadOrder = [
    ...(primaryPhoto ? [primaryPhoto] : []),
    ...otherPhotos,
    ...pendingGifs,
  ];

  for (const image of uploadOrder) {
    await api.uploadProductImage(productId, image.file, variantId);
  }

  revokePendingImages(pending);
  return api.getProductImages(productId, variantId);
}

function validateMediaFile(file, images, show, maxPhotos, maxGifs) {
  if (!file) return false;

  if (file.size > MAX_FILE_SIZE) {
    show('Файл больше 10 МБ', 'error');
    return false;
  }

  const isGif = file.type === 'image/gif';
  const allowed = isGif
    ? ['image/gif']
    : ['image/jpeg', 'image/png', 'image/webp'];

  if (!allowed.includes(file.type)) {
    show('Допустимы JPG, PNG, WEBP и GIF', 'error');
    return false;
  }

  const photoCount = images.filter((i) => i.media_type === 'photo').length;
  const gifCount = images.filter((i) => i.media_type === 'gif').length;

  if (isGif && gifCount >= maxGifs) {
    show(`Максимум ${maxGifs} GIF`, 'error');
    return false;
  }
  if (!isGif && photoCount >= maxPhotos) {
    show(`Максимум ${maxPhotos} фото`, 'error');
    return false;
  }

  return true;
}

function buildSlots(items, max) {
  const slots = [...items];
  while (slots.length < max) slots.push(null);
  return slots.slice(0, max);
}

function MediaCube({
  image,
  empty,
  canEdit,
  showPrimary,
  uploading,
  onSelect,
  onDelete,
  onSetPrimary,
}) {
  if (empty) {
    return (
      <div className="product-media-cube product-media-cube-empty">
        <span className="product-media-cube-icon product-media-cube-icon-muted">☆</span>
        <span className="product-media-cube-icon product-media-cube-icon-muted product-media-cube-icon-right">✕</span>
        <div className="product-media-cube-empty-body">
          <span className="product-media-cube-empty-icon">🖼</span>
          {canEdit && (
            <button
              type="button"
              className="product-media-cube-select"
              disabled={uploading}
              onClick={onSelect}
            >
              Выбрать
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`product-media-cube${image.is_primary ? ' product-media-cube-primary' : ''}`}>
      {showPrimary && canEdit && (
        <button
          type="button"
          className={`product-media-cube-icon product-media-cube-star${image.is_primary ? ' active' : ''}`}
          title="Главное фото"
          onClick={() => onSetPrimary(image.id)}
        >
          {image.is_primary ? '★' : '☆'}
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className="product-media-cube-icon product-media-cube-icon-right"
          title="Удалить"
          onClick={() => onDelete(image.id)}
        >
          ✕
        </button>
      )}
      <img src={image.url} alt={image.original_name || 'Медиа'} className="product-media-cube-img" />
      {image.media_type === 'gif' && <span className="product-media-cube-badge">GIF</span>}
    </div>
  );
}

function MediaCubeRow({
  label,
  maxSlots,
  items,
  mediaType,
  canEdit,
  uploading,
  onSelectFile,
  onDelete,
  onSetPrimary,
  showPrimary,
}) {
  const slots = useMemo(() => buildSlots(items, maxSlots), [items, maxSlots]);

  return (
    <div className="product-media-row">
      <div className="product-media-row-label">{label}</div>
      <div className={`product-media-cubes product-media-cubes-${mediaType}`}>
        {slots.map((image, index) => (
          <MediaCube
            key={image?.id || `empty-${mediaType}-${index}`}
            image={image}
            empty={!image}
            canEdit={canEdit}
            showPrimary={showPrimary}
            uploading={uploading}
            onSelect={onSelectFile}
            onDelete={onDelete}
            onSetPrimary={onSetPrimary}
          />
        ))}
      </div>
    </div>
  );
}

export default function ProductMediaCubes({
  productId,
  variantId = null,
  images,
  setImages,
  canEdit,
  uploading,
  setUploading,
  show,
  maxPhotos = MAX_PHOTOS,
  maxGifs = MAX_GIFS,
  compact = false,
  collapsible = false,
  defaultExpanded,
}) {
  const fileInputRef = useRef(null);
  const [expanded, setExpanded] = useState(() => {
    if (!collapsible) return true;
    if (defaultExpanded !== undefined) return defaultExpanded;
    return images.length > 0;
  });

  const photoItems = useMemo(
    () => images
      .filter((i) => i.media_type === 'photo')
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order),
    [images],
  );
  const gifItems = useMemo(
    () => images.filter((i) => i.media_type === 'gif'),
    [images],
  );

  const uploadFile = useCallback(async (file) => {
    if (!file) return;
    if (!validateMediaFile(file, images, show, maxPhotos, maxGifs)) return;

    if (!productId) {
      const pending = createPendingImage(file, images);
      setImages((prev) => [...prev, pending]);
      show(pending.media_type === 'gif' ? 'GIF добавлен' : 'Фото добавлено');
      return;
    }

    setUploading(true);
    try {
      const image = await api.uploadProductImage(productId, file, variantId);
      setImages((prev) => [...prev, image]);
      show(image.media_type === 'gif' ? 'GIF добавлен' : 'Фото добавлено');
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }, [productId, variantId, images, setImages, setUploading, show, maxPhotos, maxGifs]);

  const handleFileInput = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  useEffect(() => {
    if (!canEdit) return undefined;

    const onPaste = (e) => {
      if (uploading) return;
      if (e.target.matches('input, textarea, select')) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) {
          e.preventDefault();
          uploadFile(file);
          break;
        }
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit, uploading, uploadFile]);

  const removePendingImage = (imageId) => {
    setImages((prev) => {
      const removed = prev.find((i) => i.id === imageId);
      if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url);

      const next = prev.filter((i) => i.id !== imageId);
      if (removed?.is_primary && removed.media_type === 'photo') {
        const firstPhoto = next.find((i) => i.media_type === 'photo');
        if (firstPhoto) {
          return next.map((i) => ({
            ...i,
            is_primary: i.media_type === 'photo' && i.id === firstPhoto.id,
          }));
        }
      }
      return next;
    });
  };

  const handleDelete = async (imageId) => {
    if (!confirm('Удалить файл?')) return;

    const image = images.find((i) => i.id === imageId);
    if (image?.pending) {
      removePendingImage(imageId);
      show('Файл удалён');
      return;
    }

    if (!productId) return;

    try {
      await api.deleteProductImage(productId, imageId);
      const next = await api.getProductImages(productId, variantId);
      setImages(next);
      show('Файл удалён');
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const handleSetPrimary = async (imageId) => {
    const target = images.find((i) => i.id === imageId);
    if (!target || target.media_type !== 'photo') return;

    if (target.pending || !productId) {
      setImages((prev) => prev.map((i) => ({
        ...i,
        is_primary: i.media_type === 'photo' && i.id === imageId,
      })));
      show('Главное фото установлено');
      return;
    }

    try {
      const next = await api.setPrimaryProductImage(productId, imageId);
      setImages(next);
      show('Главное фото установлено');
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const openFileDialog = () => {
    if (!canEdit || uploading) return;
    fileInputRef.current?.click();
  };

  const mediaCount = images.length;
  const showBody = !collapsible || expanded;

  return (
    <div className={`product-media-panel${compact ? ' product-media-panel-compact' : ''}${collapsible ? ' product-media-panel-collapsible' : ''}${expanded ? ' is-expanded' : ' is-collapsed'}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={handleFileInput}
      />

      {collapsible && (
        <button
          type="button"
          className="product-media-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="product-media-toggle-chevron" aria-hidden>{expanded ? '▾' : '▸'}</span>
          <span className="product-media-toggle-label">Фото и GIF</span>
          {mediaCount > 0 && (
            <span className="product-media-toggle-count">{mediaCount}</span>
          )}
        </button>
      )}

      {showBody && (
        <div className="product-media-body">
      <MediaCubeRow
        label="Фото"
        maxSlots={maxPhotos}
        items={photoItems}
        mediaType="photo"
        canEdit={canEdit}
        uploading={uploading}
        showPrimary={maxPhotos > 1}
        onSelectFile={openFileDialog}
        onDelete={handleDelete}
        onSetPrimary={handleSetPrimary}
      />

      <MediaCubeRow
        label="GIF"
        maxSlots={maxGifs}
        items={gifItems}
        mediaType="gif"
        canEdit={canEdit}
        uploading={uploading}
        showPrimary={false}
        onSelectFile={openFileDialog}
        onDelete={handleDelete}
        onSetPrimary={handleSetPrimary}
      />

      {!compact && (
        <p className="product-media-hint">
          ☆ — главное фото · ✕ — удалить · «Выбрать» — загрузка файла · <strong>Ctrl+V</strong> — вставить из буфера.
          Рекомендуемый размер: 1080×1080 px, до 10 МБ.
        </p>
      )}
        </div>
      )}
    </div>
  );
}
