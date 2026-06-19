import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';
import { useToast } from '../components/Modal';
import ShopStorefront from '../components/myshop/ShopStorefront';
import BlockAddModal from '../components/myshop/BlockAddModal';
import { IconImage, IconTrash } from '../components/ActionIcons';
import { IconNavShop } from '../components/NavIcons';
import {
  buildCategoryImageMap,
  canAddCategoryToBlock,
  createBlock,
  createEmptyLayout,
  getBlockMeta,
} from '../utils/myShopLayout';

function Toggle({ label, checked, onChange }) {
  return (
    <label className="myshop-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="myshop-switch-track" aria-hidden />
      <span className="myshop-switch-label">{label}</span>
    </label>
  );
}

function BlockEditorCard({
  block,
  index,
  total,
  selected,
  onSelect,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  categoriesById,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const meta = getBlockMeta(block.type);

  const removeCategory = (categoryId) => {
    onChange({
      ...block,
      categoryIds: block.categoryIds.filter((id) => id !== categoryId),
    });
  };

  return (
    <div className={`myshop-block-editor${selected ? ' is-selected' : ''}`}>
      <div className="myshop-block-editor-head">
        <button type="button" className="myshop-block-editor-select" onClick={onSelect}>
          <span className="myshop-block-editor-index">#{index + 1}</span>
          <strong>{meta.shortLabel}</strong>
          {meta.max != null && <span className="myshop-block-count">{block.categoryIds.length}/{meta.max}</span>}
        </button>
        <div className="myshop-block-editor-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={onMoveUp}>↑</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={index === total - 1} onClick={onMoveDown}>↓</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm myshop-block-editor-remove" onClick={onRemove} title="Удалить блок">
            <IconTrash />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="myshop-block-editor-body">
          <label className="myshop-field">
            <span>Название блока (видно клиенту)</span>
            <input
              type="text"
              value={block.title}
              placeholder="Например: Личная гигиена"
              onChange={(e) => onChange({ ...block, title: e.target.value })}
            />
          </label>
          <div className="myshop-block-editor-chips">
            {block.categoryIds.length === 0 && (
              <span className="myshop-block-editor-hint">Нажмите категорию в центральной колонке</span>
            )}
            {block.categoryIds.map((categoryId, chipIndex) => {
              const category = categoriesById.get(categoryId);
              return (
                <span key={categoryId} className="myshop-block-chip">
                  <span className="myshop-block-chip-num">{chipIndex + 1}</span>
                  {category?.name || categoryId}
                  <button type="button" onClick={() => removeCategory(categoryId)} aria-label="Удалить">×</button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyShopConstructor() {
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const { show, Toast } = useToast();
  const canEdit = hasPermission(user, 'myshop.edit');

  const [layout, setLayout] = useState(createEmptyLayout);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [previewSearch, setPreviewSearch] = useState('');
  const [shopSettings, setShopSettings] = useState({ enabled: true, notifyChatId: '' });
  const [savingShopSettings, setSavingShopSettings] = useState(false);

  const publicShopUrl = branchId ? `${window.location.origin}/shop/${branchId}` : '';

  const copyPublicLink = async () => {
    if (!publicShopUrl) return;
    try {
      await navigator.clipboard.writeText(publicShopUrl);
      show('Ссылка скопирована');
    } catch {
      show('Не удалось скопировать ссылку', 'error');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [layoutData, productList, categoryList, settingsData] = await Promise.all([
        api.getMyShopLayout(),
        api.getProducts(),
        api.getProductCategories(),
        api.getShopSettings(),
      ]);
      setLayout(layoutData);
      setProducts(productList);
      setCategories(categoryList);
      setShopSettings(settingsData);
      setSelectedBlockId((current) => current || layoutData.blocks[0]?.id || null);
    } catch (err) {
      console.error(err);
      show(err.message || 'Не удалось загрузить конструктор', 'error');
    } finally {
      setLoading(false);
    }
  }, [branchId, show]);

  useEffect(() => { load(); }, [load, branchId]);

  const categoryImages = useMemo(() => buildCategoryImageMap(products), [products]);
  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    return categories
      .filter((category) => (category.product_count || 0) > 0 || products.some((p) => p.category_id === category.id))
      .filter((category) => !q || category.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [categories, categorySearch, products]);

  const selectedBlock = layout.blocks.find((b) => b.id === selectedBlockId) || null;

  const updateSettings = (patch) => {
    setLayout((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  };

  const updateBlock = (blockId, nextBlock) => {
    setLayout((prev) => ({
      ...prev,
      blocks: prev.blocks.map((block) => (block.id === blockId ? nextBlock : block)),
    }));
  };

  const addBlock = (type) => {
    const block = createBlock(type);
    setLayout((prev) => ({ ...prev, blocks: [...prev.blocks, block] }));
    setSelectedBlockId(block.id);
    setAddModalOpen(false);
  };

  const removeBlock = (blockId) => {
    setLayout((prev) => {
      const blocks = prev.blocks.filter((block) => block.id !== blockId);
      return { ...prev, blocks };
    });
    setSelectedBlockId((current) => (current === blockId ? null : current));
  };

  const moveBlock = (blockId, direction) => {
    setLayout((prev) => {
      const index = prev.blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return prev;
      const target = index + direction;
      if (target < 0 || target >= prev.blocks.length) return prev;
      const blocks = [...prev.blocks];
      const [item] = blocks.splice(index, 1);
      blocks.splice(target, 0, item);
      return { ...prev, blocks };
    });
  };

  const addCategoryToSelectedBlock = (categoryId) => {
    if (!selectedBlock) {
      show('Сначала выберите блок справа', 'error');
      return;
    }
    if (!canAddCategoryToBlock(selectedBlock, categoryId)) {
      const limit = getBlockMeta(selectedBlock.type).max;
      show(limit != null ? `В блоке максимум ${limit} категорий` : 'Категория уже добавлена', 'error');
      return;
    }
    updateBlock(selectedBlock.id, {
      ...selectedBlock,
      categoryIds: [...selectedBlock.categoryIds, categoryId],
    });
  };

  const saveShopSettings = async () => {
    setSavingShopSettings(true);
    try {
      const saved = await api.saveShopSettings(shopSettings);
      setShopSettings(saved);
      show('Настройки заказов сохранены');
    } catch (err) {
      show(err.message || 'Не удалось сохранить настройки', 'error');
    } finally {
      setSavingShopSettings(false);
    }
  };

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const saved = await api.saveMyShopLayout(layout);
      setLayout(saved);
      show('Витрина сохранена');
    } catch (err) {
      show(err.message || 'Не удалось сохранить', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <div className="card">
        <div className="empty">Нет прав на редактирование витрины MyShop</div>
      </div>
    );
  }

  return (
    <div className="myshop-constructor">
      {Toast}
      <div className="myshop-constructor-top card">
        <div className="myshop-constructor-title">
          <span className="myshop-constructor-title-icon" aria-hidden><IconNavShop /></span>
          <div>
            <h1>Конструктор MyShop</h1>
            <p className="page-subtitle">{branchName} · CMS мобильного магазина</p>
          </div>
        </div>
        <div className="myshop-constructor-top-actions">
          <Link to="/myshop" className="btn btn-ghost">Открыть магазин</Link>
          <button type="button" className="btn btn-ghost" onClick={() => setAddModalOpen(true)}>+ Добавить блок</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>

      <div className="myshop-constructor-toolbar card">
        <Toggle label="Витрина" checked={layout.settings.showcase} onChange={(v) => updateSettings({ showcase: v })} />
        <Toggle label="Меню" checked={layout.settings.menu} onChange={(v) => updateSettings({ menu: v })} />
        <Toggle label="Скрыть фон" checked={layout.settings.hideBackground} onChange={(v) => updateSettings({ hideBackground: v })} />
        <Toggle label="Прозрачный фон" checked={layout.settings.transparentBackground} onChange={(v) => updateSettings({ transparentBackground: v })} />
        <Toggle label="Снаружи фото" checked={layout.settings.photoOutside} onChange={(v) => updateSettings({ photoOutside: v })} />
      </div>

      <div className="card myshop-public-settings">
        <div className="myshop-public-settings-head">
          <div>
            <h2>Публичный магазин и заказы</h2>
            <p className="page-subtitle">Ссылка для клиентов и уведомления в Telegram</p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={saveShopSettings} disabled={savingShopSettings}>
            {savingShopSettings ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
        </div>
        <div className="myshop-public-settings-grid">
          <Toggle
            label="Приём заказов"
            checked={shopSettings.enabled !== false}
            onChange={(v) => setShopSettings((prev) => ({ ...prev, enabled: v }))}
          />
          <label className="myshop-field">
            <span>Telegram Chat ID для заказов</span>
            <input
              value={shopSettings.notifyChatId || ''}
              onChange={(e) => setShopSettings((prev) => ({ ...prev, notifyChatId: e.target.value }))}
              placeholder="Получите через /start у бота"
            />
          </label>
          <div className="myshop-public-link">
            <span>Публичная ссылка</span>
            <div className="myshop-public-link-row">
              <input value={publicShopUrl} readOnly />
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyPublicLink}>Копировать</button>
              <a href={publicShopUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Открыть</a>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card"><div className="empty">Загрузка...</div></div>
      ) : (
        <div className="myshop-constructor-grid">
          <section className="card myshop-constructor-panel myshop-constructor-preview">
            <div className="myshop-constructor-panel-head">
              <strong>Предпросмотр магазина</strong>
              <span className="myshop-panel-badge">Live</span>
            </div>
            <div className="myshop-constructor-phone-wrap">
              <div className="myshop-device-frame">
                <div className="myshop-device-notch" aria-hidden />
                <div className="myshop-constructor-phone">
                  <ShopStorefront
                    preview
                    layout={layout}
                    categories={categories}
                    products={products}
                    branchName={branchName}
                    search={previewSearch}
                    onSearchChange={setPreviewSearch}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="card myshop-constructor-panel myshop-constructor-categories">
            <div className="myshop-constructor-panel-head">
              <div className="myshop-constructor-tabs">
                <button type="button" className="myshop-constructor-tab active">Категории</button>
              </div>
              {selectedBlock && (
                <span className="myshop-panel-target">
                  в блок «{getBlockMeta(selectedBlock.type).shortLabel}»
                </span>
              )}
            </div>
            <input
              type="search"
              className="myshop-constructor-search"
              placeholder="Поиск категории..."
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
            />
            <div className="myshop-constructor-category-list">
              {!selectedBlock && layout.blocks.length > 0 && (
                <div className="myshop-constructor-empty myshop-constructor-empty-inline">
                  Выберите блок справа, затем нажмите категорию
                </div>
              )}
              {!selectedBlock && layout.blocks.length === 0 && (
                <div className="myshop-constructor-empty myshop-constructor-empty-inline">
                  Сначала добавьте блок витрины справа
                </div>
              )}
              {filteredCategories.map((category) => {
                const imageUrl = categoryImages.get(category.id);
                const count = category.product_count
                  || products.filter((p) => p.category_id === category.id).length;
                const inSelected = selectedBlock?.categoryIds.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={`myshop-constructor-category${inSelected ? ' is-added' : ''}${!selectedBlock ? ' is-disabled' : ''}`}
                    onClick={() => addCategoryToSelectedBlock(category.id)}
                    disabled={!selectedBlock}
                  >
                    <div className="myshop-constructor-category-thumb">
                      {imageUrl ? <img src={imageUrl} alt="" /> : <IconImage />}
                    </div>
                    <div className="myshop-constructor-category-meta">
                      <strong>{category.name}</strong>
                      <span>{count} товаров</span>
                    </div>
                    {inSelected && <span className="myshop-constructor-category-check">✓</span>}
                  </button>
                );
              })}
              {filteredCategories.length === 0 && (
                <div className="myshop-constructor-empty">Категории не найдены</div>
              )}
            </div>
          </section>

          <section className="card myshop-constructor-panel myshop-constructor-blocks">
            <div className="myshop-constructor-panel-head">
              <strong>Блоки витрины</strong>
              <span className="myshop-panel-badge">{layout.blocks.length}</span>
            </div>
            {layout.blocks.length === 0 ? (
              <div className="myshop-constructor-empty myshop-constructor-empty-blocks">
                <div className="myshop-constructor-empty-art" aria-hidden />
                <p>Добавьте первый блок меню</p>
                <button type="button" className="btn btn-primary" onClick={() => setAddModalOpen(true)}>
                  + Добавить блок
                </button>
              </div>
            ) : (
              <div className="myshop-block-editor-list">
                {layout.blocks.map((block, index) => (
                  <BlockEditorCard
                    key={block.id}
                    block={block}
                    index={index}
                    total={layout.blocks.length}
                    selected={selectedBlockId === block.id}
                    onSelect={() => setSelectedBlockId(block.id)}
                    onChange={(next) => updateBlock(block.id, next)}
                    onRemove={() => removeBlock(block.id)}
                    onMoveUp={() => moveBlock(block.id, -1)}
                    onMoveDown={() => moveBlock(block.id, 1)}
                    categoriesById={categoriesById}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {addModalOpen && (
        <BlockAddModal
          onClose={() => setAddModalOpen(false)}
          onSelect={addBlock}
        />
      )}
    </div>
  );
}
