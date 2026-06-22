import { useMemo, useState } from 'react';
import { api } from '../api';
import CategorySelect from './CategorySelect';
import { IconButton, IconPlus } from './ActionIcons';

const emptyQuickForm = { name: '', parent_id: '' };

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
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quickForm, setQuickForm] = useState(emptyQuickForm);
  const [error, setError] = useState('');

  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parent_id && c.id !== 'other'),
    [categories],
  );

  const closeQuickAdd = () => {
    setAdding(false);
    setQuickForm(emptyQuickForm);
    setError('');
  };

  const openQuickAdd = () => {
    const current = categories.find((c) => c.id === value);
    setQuickForm({
      name: '',
      parent_id: current?.parent_id || (current && !current.parent_id ? current.id : ''),
    });
    setError('');
    setAdding(true);
  };

  const saveCategory = async () => {
    const name = quickForm.name.trim();
    if (!name) {
      setError('Укажите название категории');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.createProductCategory({
        name,
        parent_id: quickForm.parent_id || null,
      });
      onChange(created.id);
      onCategoryCreated?.(created);
      closeQuickAdd();
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
          <IconButton
            title="Добавить категорию"
            className="category-select-with-add-btn"
            onClick={openQuickAdd}
          >
            <IconPlus />
          </IconButton>
        )}
      </div>

      {adding && (
        <div className="category-quick-add">
          <div className="category-quick-add-grid">
            <div className="form-group">
              <label>Название категории *</label>
              <input
                autoFocus
                value={quickForm.name}
                onChange={(e) => setQuickForm({ ...quickForm, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveCategory();
                  }
                  if (e.key === 'Escape') closeQuickAdd();
                }}
                placeholder="Например, Go'shtlar"
              />
            </div>
            <div className="form-group">
              <label>Родительская категория</label>
              <CategorySelect
                categories={rootCategories}
                value={quickForm.parent_id || ''}
                onChange={(parent_id) => setQuickForm({ ...quickForm, parent_id })}
                tree={false}
                includeEmpty
                emptyLabel="— верхний уровень —"
              />
            </div>
          </div>
          {error && <p className="category-quick-add-error">{error}</p>}
          <div className="category-quick-add-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeQuickAdd} disabled={saving}>
              Отмена
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveCategory} disabled={saving}>
              {saving ? 'Сохранение…' : 'Создать'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
