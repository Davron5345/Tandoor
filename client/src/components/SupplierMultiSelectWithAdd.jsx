import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import Modal, { ModalCancelButton } from './Modal';
import SupplierMultiSelect from './SupplierMultiSelect';
import CounterpartyFormFields, { emptyCounterpartyForm } from './CounterpartyFormFields';
import { IconPlus } from './ActionIcons';
import { useFormDirty } from '../hooks/useFormDirty';

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
  const [form, setForm] = useState(emptyCounterpartyForm);
  const [error, setError] = useState('');
  const isFormDirty = useFormDirty(form, modalOpen ? 'supplier-create' : null);

  const closeModal = () => {
    setModalOpen(false);
    setForm(emptyCounterpartyForm);
    setError('');
  };

  const openModal = () => {
    setForm(emptyCounterpartyForm);
    setError('');
    setModalOpen(true);
  };

  const saveSupplier = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Укажите название');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await api.createCounterparty({ ...form, name, type: 'supplier' });
      onSupplierCreated?.(created);
      if (!value.includes(created.id)) {
        onChange([...value, created.id]);
      }
      closeModal();
    } catch (e) {
      setError(e.message || 'Не удалось создать контрагента');
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
          title="Новый контрагент"
          dirty={isFormDirty}
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
          <CounterpartyFormFields form={form} setForm={setForm} lockType="supplier" />
          {error && <p className="form-error">{error}</p>}
        </Modal>,
        document.body,
      )}
    </>
  );
}
