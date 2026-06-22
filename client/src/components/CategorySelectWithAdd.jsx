import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import CategorySelect from './CategorySelect';
import Modal, { ModalCancelButton } from './Modal';
import { IconPlus } from './ActionIcons';

const emptyForm = { name: '', parent_id: '', sort_order: 0 };

export default function CategorySelectWithAdd({
  categories,
  value,
  onChange,
  onCategoryCreated,
  selectedId,
  disabled = false,
  canAdd = true,
  className = '',
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parent_id && c.id !== 'other'),
    [categories],
  );

  const closeModal = () => {
    setModalOpen(false);
    setForm(emptyForm);
    setError('');
  };

  const openModal = () => {
    const current = categories.find((c) => c.id === value);
    setForm({
      name: '',
      parent_id: current?.parent_id || (current && !current.parent_id ? current.id : ''),
      sort_order: categories.length + 1,
    });
    setError('');
    setModalOpen(true);
  };

  const saveCategory = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Укажите название категории');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.createProductCategory({
        name,
        parent_id: form.parent_id || null,
        sort_order: form.sort_order,
      });
      onChange(created.id);
      onCategoryCreated?.(created);
      closeModal();
    } catch (e) {
      setError(e.message || 'Не удалось создать категорию');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`category-select-with-add${className ? ` ${className}` : ''}`}>
      <div className="category-select-with-add-row">
        <CategorySelect
          categories={categories}
          value={value}
          onChange={onChange}
          selectedId={selectedId ?? value}
          disabled={disabled}
        />
        {canAdd && !disabled && (
          <button
            type="button"
            className="category-select-add-btn"
            title="Добавить категорию"
            aria-label="Добавить категорию"
            onClick={openModal}
          >
            <IconPlus />
          </button>
        )}
      </div>

      {modalOpen && createPortal(
        <Modal
          title={form.parent_id ? 'Новая подкатегория' : 'Новая категория'}
          onClose={closeModal}
          footer={(
            <>
              <ModalCancelButton disabled={saving} />
              <button type="button" className="btn btn-primary" onClick={saveCategory} disabled={saving}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </>
          )}
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Название *</label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveCategory();
                  }
                }}
              />
            </div>
            <div className="form-group">
              <label>Родительская категория</label>
              <CategorySelect
                categories={rootCategories}
                value={form.parent_id || ''}
                onChange={(parent_id) => setForm({ ...form, parent_id })}
                tree={false}
                emptyLabel="— верхний уровень —"
              />
              <small className="form-hint">Выберите категорию, чтобы создать подкатегорию</small>
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
          {error && <p className="form-error">{error}</p>}
        </Modal>,
        document.body,
      )}
    </div>
  );
}
