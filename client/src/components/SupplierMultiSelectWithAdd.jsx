import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { formatUzPhone } from '../phoneFormat';
import Modal, { ModalCancelButton } from './Modal';
import SupplierMultiSelect from './SupplierMultiSelect';
import { IconPlus } from './ActionIcons';

const emptyForm = { name: '', phone: '' };

export default function SupplierMultiSelectWithAdd({
  suppliers,
  value = [],
  onChange,
  onSupplierCreated,
  disabled = false,
  canAdd = true,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const closeModal = () => {
    setModalOpen(false);
    setForm(emptyForm);
    setError('');
  };

  const openModal = () => {
    setForm(emptyForm);
    setError('');
    setModalOpen(true);
  };

  const saveSupplier = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Укажите название поставщика');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.createCounterparty({
        name,
        type: 'supplier',
        phone: form.phone.trim() || '',
      });
      onSupplierCreated?.(created);
      if (!value.includes(created.id)) {
        onChange([...value, created.id]);
      }
      closeModal();
    } catch (e) {
      setError(e.message || 'Не удалось создать поставщика');
    } finally {
      setSaving(false);
    }
  };

  const addButton = canAdd && !disabled ? (
    <button
      type="button"
      className="category-select-add-btn supplier-picker-add-btn"
      title="Добавить поставщика"
      aria-label="Добавить поставщика"
      onClick={openModal}
    >
      <IconPlus />
    </button>
  ) : null;

  return (
    <>
      <SupplierMultiSelect
        suppliers={suppliers}
        value={value}
        onChange={onChange}
        disabled={disabled}
        addButton={addButton}
        emptyMessage="Нет поставщиков. Нажмите +, чтобы добавить."
      />

      {modalOpen && createPortal(
        <Modal
          title="Новый поставщик"
          onClose={closeModal}
          footer={(
            <>
              <ModalCancelButton disabled={saving} />
              <button type="button" className="btn btn-primary" onClick={saveSupplier} disabled={saving}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </>
          )}
        >
          <div className="form-grid">
            <div className="form-group full">
              <label>Название *</label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveSupplier();
                  }
                }}
              />
            </div>
            <div className="form-group full">
              <label>Телефон</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: formatUzPhone(e.target.value) })}
                placeholder="+998 __ ___ __ __"
              />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
        </Modal>,
        document.body,
      )}
    </>
  );
}
