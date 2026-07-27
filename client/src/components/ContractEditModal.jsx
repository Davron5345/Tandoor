import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, formatPriceInput, parsePriceInput } from '../api';
import Modal, { ModalCancelButton, useToast } from './Modal';
import { useFormDirty } from '../hooks/useFormDirty';
import { amountInWordsCapitalized } from '../utils/amountInWords';

export const emptyContractForm = {
  title: '',
  number: '',
  date: '',
  end_date: '',
  direction: 'outgoing',
  amount: '',
};

export function contractToForm(c) {
  return {
    title: c?.title || '',
    number: c?.number || '',
    date: c?.date || '',
    end_date: c?.end_date || '',
    direction: c?.direction === 'incoming' ? 'incoming' : 'outgoing',
    amount: c?.amount != null && Number(c.amount) > 0
      ? formatPriceInput(Math.round(Number(c.amount)))
      : '',
  };
}

export function formatContractOptionLabel(c) {
  if (!c) return '';
  const title = (c.title || '').trim();
  const number = (c.number || '').trim();
  if (title && number && title !== number) return `${title} · ${number}`;
  return title || number || '—';
}

/**
 * Модалка создания / редактирования договора контрагента.
 * contractId = null → создание.
 */
export default function ContractEditModal({
  open,
  counterpartyId,
  contractId = null,
  initial = null,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState(emptyContractForm);
  const [saving, setSaving] = useState(false);
  const { show, Toast } = useToast();
  const isDirty = useFormDirty(form, open ? `contract-${contractId || 'create'}` : null);
  const amountNumber = parsePriceInput(form.amount) || 0;
  const amountWords = amountNumber > 0 ? amountInWordsCapitalized(amountNumber) : '';

  useEffect(() => {
    if (!open) return;
    setForm(initial ? contractToForm(initial) : emptyContractForm);
  }, [open, contractId, initial]);

  if (!open) return null;

  const save = async () => {
    if (!counterpartyId) return;
    if (!String(form.number || '').trim()) {
      show('Укажите номер договора', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim() || null,
        number: form.number.trim(),
        date: form.date || null,
        end_date: form.end_date || null,
        direction: form.direction || null,
        amount: parsePriceInput(form.amount) || 0,
      };
      const saved = contractId
        ? await api.updateCounterpartyContract(counterpartyId, contractId, payload)
        : await api.createCounterpartyContract(counterpartyId, payload);
      show(contractId ? 'Договор обновлён' : 'Договор создан');
      onSaved?.(saved);
      onClose?.();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <>
      {Toast}
      <Modal
        title={contractId ? 'Редактировать договор' : 'Новый договор'}
        dirty={isDirty}
        onClose={onClose}
        footer={(
          <>
            <ModalCancelButton disabled={saving} />
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </>
        )}
      >
        <div className="form-grid">
          <div className="form-group full">
            <label>Название</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Договор поставки"
            />
          </div>
          <div className="form-group">
            <label>Номер</label>
            <input
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              placeholder="№ 123/2026"
            />
          </div>
          <div className="form-group">
            <label>Дата</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Входящий / исходящий</label>
            <select
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value })}
            >
              <option value="outgoing">Исходящий</option>
              <option value="incoming">Входящий</option>
            </select>
          </div>
          <div className="form-group">
            <label>Сумма договора</label>
            <input
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: formatPriceInput(e.target.value) })}
              placeholder="1 000"
              inputMode="numeric"
            />
            {amountWords ? (
              <div className="form-hint amount-in-words">{amountWords}</div>
            ) : (
              <div className="form-hint">Формат: 1 000</div>
            )}
          </div>
          <div className="form-group">
            <label>Срок окончания</label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </>,
    document.body,
  );
}
