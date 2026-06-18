import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Modal, { useToast } from '../components/Modal';
import CategorySelect from '../components/CategorySelect';
import { IconButton, IconEdit, IconPlus, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { hasPermission } from '../permissions';

const empty = { name: '', sort_order: 0, parent_id: '' };

export default function ProductCategories() {
  const [categories, setCategories] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'products.edit');

  const load = () => {
    api.getProductCategories().then(setCategories).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories],
  );

  const treeRows = useMemo(() => {
    const rows = [];
    for (const root of rootCategories) {
      const subs = categories.filter((c) => c.parent_id === root.id);
      const isExpanded = expanded.has(root.id);
      rows.push({
        ...root,
        level: 0,
        hasChildren: subs.length > 0,
        isExpanded,
        childCount: subs.length,
      });
      if (isExpanded) {
        subs.forEach((sub) => rows.push({ ...sub, level: 1, parentId: root.id }));
      }
    }
    return rows;
  }, [categories, rootCategories, expanded]);

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandParent = (id) => {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const openCreate = (parentId = '') => {
    setForm({ ...empty, sort_order: categories.length + 1, parent_id: parentId });
    setModal('create');
  };

  const openCreateSub = (parent) => {
    expandParent(parent.id);
    setForm({ name: '', sort_order: (parent.subcategory_count || 0) + 1, parent_id: parent.id });
    setModal('create');
  };

  const openEdit = (cat) => {
    setForm({
      name: cat.name,
      sort_order: cat.sort_order || 0,
      parent_id: cat.parent_id || '',
    });
    setModal(cat.id);
  };

  const save = async () => {
    if (!form.name.trim()) {
      show('Укажите название категории', 'error');
      return;
    }
    try {
      const payload = {
        name: form.name,
        sort_order: form.sort_order,
        parent_id: form.parent_id || null,
      };
      if (modal === 'create') {
        await api.createProductCategory(payload);
        show(form.parent_id ? 'Подкатегория добавлена' : 'Категория добавлена');
      } else {
        await api.updateProductCategory(modal, payload);
        show('Категория обновлена');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (cat) => {
    const label = cat.parent_id ? 'подкатегорию' : 'категорию';
    if (!confirm(`Удалить ${label} «${cat.name}»? Товары будут перенесены в «Прочее».`)) return;
    try {
      await api.deleteProductCategory(cat.id);
      show('Удалено');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Категории товаров</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => openCreate()}>+ Категория</button>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Уровень</th>
                <th>Порядок</th>
                <th>Товаров</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {treeRows.map((c) => (
                <tr
                  key={c.id}
                  className={[
                    c.level === 1 ? 'subcategory-row' : '',
                    c.level === 0 && c.hasChildren ? 'category-parent-row' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td>
                    {c.level === 0 ? (
                      <div className="category-name-cell">
                        {c.hasChildren ? (
                          <button
                            type="button"
                            className="category-toggle"
                            onClick={() => toggleExpand(c.id)}
                            aria-expanded={c.isExpanded}
                            title={c.isExpanded ? 'Скрыть подкатегории' : 'Показать подкатегории'}
                          >
                            {c.isExpanded ? '▾' : '▸'}
                          </button>
                        ) : (
                          <span className="category-toggle-spacer" aria-hidden />
                        )}
                        <button
                          type="button"
                          className={`category-name-btn${c.hasChildren ? ' category-name-btn-toggle' : ''}`}
                          onClick={c.hasChildren ? () => toggleExpand(c.id) : undefined}
                          disabled={!c.hasChildren}
                        >
                          {c.name}
                        </button>
                        {c.hasChildren && (
                          <span className="product-meta category-child-count">
                            {c.childCount} подкат.
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="subcategory-name">↳ {c.name}</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge badge-${c.level === 1 ? 'supplier' : 'confirmed'}`}>
                      {c.level === 1 ? 'Подкатегория' : 'Категория'}
                    </span>
                  </td>
                  <td>{c.sort_order ?? 0}</td>
                  <td>
                    {c.product_count > 0 ? (
                      <Link to={`/products?category=${c.id}`} className="category-link">
                        {c.product_count} поз.
                      </Link>
                    ) : (
                      <span className="product-meta">0</span>
                    )}
                  </td>
                  <td>
                    {canEdit ? (
                      <div className="btn-group btn-group-icons">
                        {c.level === 0 && c.id !== 'other' && (
                          <IconButton title="Добавить подкатегорию" onClick={() => openCreateSub(c)}>
                            <IconPlus />
                          </IconButton>
                        )}
                        <IconButton title="Изменить" onClick={() => openEdit(c)}>
                          <IconEdit />
                        </IconButton>
                        {c.id !== 'other' && (
                          <IconButton title="Удалить" danger onClick={() => remove(c)}>
                            <IconTrash />
                          </IconButton>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {treeRows.length === 0 && (
                <tr><td colSpan={5} className="empty">Нет категорий</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          title={
            modal === 'create'
              ? (form.parent_id ? 'Новая подкатегория' : 'Новая категория')
              : 'Редактировать категорию'
          }
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Название *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Родительская категория</label>
              <CategorySelect
                categories={rootCategories.filter((c) => c.id !== 'other' && c.id !== modal)}
                value={form.parent_id || ''}
                onChange={(parent_id) => setForm({ ...form, parent_id })}
                tree={false}
                emptyLabel="— верхний уровень —"
                disabled={
                  modal !== 'create'
                  && (modal === 'other' || (categories.find((c) => c.id === modal)?.subcategory_count > 0))
                }
              />
              <small style={{ color: 'var(--text-muted)' }}>
                Выберите категорию, чтобы создать подкатегорию
              </small>
            </div>
            <div className="form-group">
              <label>Порядок сортировки</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: +e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
