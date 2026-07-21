import { useState } from 'react';
import { api } from '../api';
import SupplierMultiSelect from './SupplierMultiSelect';
import CounterpartyCreateModal from './CounterpartyCreateModal';
import { IconPlus } from './ActionIcons';

export default function SupplierMultiSelectWithAdd({
  suppliers,
  value = [],
  onChange,
  onSupplierCreated,
  disabled = false,
  canAdd = true,
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const addButton = canAdd && !disabled ? (
    <button
      type="button"
      className="category-select-add-btn supplier-picker-add-btn"
      title="Добавить поставщика"
      aria-label="Добавить поставщика"
      onClick={() => setModalOpen(true)}
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

      <CounterpartyCreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        lockType="supplier"
        title="Новый контрагент"
        onCreated={(created) => {
          onSupplierCreated?.(created);
          if (!value.includes(created.id)) {
            onChange([...value, created.id]);
          }
        }}
      />
    </>
  );
}
