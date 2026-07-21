import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import Modal, { ModalCancelButton } from './Modal';
import CounterpartyFormFields, { emptyCounterpartyForm } from './CounterpartyFormFields';
import { useFormDirty } from '../hooks/useFormDirty';

/**
 * То же окно «Новый контрагент», что в карточке товара / справочнике.
 * lockType='supplier' | 'client' | null
 */
export default function CounterpartyCreateModal({
  open,
  onClose,
  onCreated,
  lockType = 'supplier',
  title = 'Новый контрагент',
}) {
  const defaultType = lockType === 'client' ? 'client' : 'supplier';
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    ...emptyCounterpartyForm,
    type: defaultType,
  }));
  const [error, setError] = useState('');
  const isFormDirty = useFormDirty(form, open ? 'counterparty-create' : null);

  useEffect(() => {
    if (!open) return;
    setForm({ ...emptyCounterpartyForm, type: defaultType });
    setError('');
  }, [open, defaultType]);

  if (!open) return null;

  const close = () => {
    setForm({
      ...emptyCounterpartyForm,
      type: lockType === 'client' ? 'client' : 'supplier',
    });
    setError('');
    onClose?.();
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Укажите название');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const type = lockType === 'client' || lockType === 'supplier'
        ? lockType
        : form.type;
      const created = await api.createCounterparty({ ...form, name, type });
      onCreated?.(created);
      close();
    } catch (e) {
      setError(e.message || 'Не удалось создать контрагента');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <Modal
      title={title}
      dirty={isFormDirty}
      onClose={close}
      footer={(
        <>
          <ModalCancelButton disabled={saving} />
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>
      )}
    >
      <CounterpartyFormFields
        form={form}
        setForm={setForm}
        lockType={lockType === 'client' || lockType === 'supplier' ? lockType : null}
      />
      {error && <p className="form-error">{error}</p>}
    </Modal>,
    document.body,
  );
}
