import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import Modal, { ModalCancelButton, useToast } from './Modal';
import { IconButton, IconEdit, IconPlus, IconTrash } from './ActionIcons';
import { useFormDirty } from '../hooks/useFormDirty';

const emptyFirm = {
  name: '',
  inn: '',
  bank_account: '',
  mfo: '',
  contract_id: '',
  is_default: false,
};

const emptyContract = {
  title: '',
  number: '',
  date: '',
  end_date: '',
  direction: 'outgoing',
  amount: '',
};

export function formatContractOptionLabel(c) {
  if (!c) return '';
  const title = (c.title || '').trim();
  const number = (c.number || '').trim();
  if (title && number && title !== number) return `${title} · ${number}`;
  return title || number || '—';
}

function firmToForm(f) {
  return {
    name: f.name || '',
    inn: f.inn || '',
    bank_account: f.bank_account || '',
    mfo: f.mfo || '',
    contract_id: f.contract_id || '',
    is_default: Boolean(f.is_default),
  };
}

export default function CounterpartyFirmsModal({
  counterpartyId,
  contracts: contractsProp = [],
  canEdit,
  onClose,
  onChanged,
  onContractsChanged,
}) {
  const [firms, setFirms] = useState([]);
  const [contracts, setContracts] = useState(contractsProp);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(null); // 'create' | firmId
  const [firmForm, setFirmForm] = useState(emptyFirm);
  const [saving, setSaving] = useState(false);
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractForm, setContractForm] = useState(emptyContract);
  const [contractSaving, setContractSaving] = useState(false);
  const { show, Toast } = useToast();
  const isFirmDirty = useFormDirty(firmForm, editModal ? `firm-${editModal}` : null);
  const isContractDirty = useFormDirty(contractForm, contractModalOpen ? 'firm-contract' : null);

  const loadFirms = useCallback(() => {
    if (!counterpartyId) {
      setFirms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.getCounterpartyFirms(counterpartyId)
      .then(setFirms)
      .catch(() => setFirms([]))
      .finally(() => setLoading(false));
  }, [counterpartyId]);

  const loadContracts = useCallback(() => {
    if (!counterpartyId) {
      setContracts([]);
      return;
    }
    api.getCounterpartyContracts(counterpartyId)
      .then((list) => setContracts(list.filter((c) => c.id !== '__default__' && !c.virtual)))
      .catch(() => setContracts([]));
  }, [counterpartyId]);

  useEffect(() => {
    loadFirms();
    loadContracts();
  }, [loadFirms, loadContracts]);

  useEffect(() => {
    setContracts(contractsProp.filter((c) => c.id !== '__default__' && !c.virtual));
  }, [contractsProp]);

  const openCreate = () => {
    setFirmForm(emptyFirm);
    setEditModal('create');
  };

  const openEdit = (f) => {
    setFirmForm(firmToForm(f));
    setEditModal(f.id);
  };

  const closeEdit = () => {
    setContractModalOpen(false);
    setEditModal(null);
    setFirmForm(emptyFirm);
  };

  const saveFirm = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      if (editModal === 'create') {
        await api.createCounterpartyFirm(counterpartyId, firmForm);
        show('Фирма добавлена');
      } else {
        await api.updateCounterpartyFirm(counterpartyId, editModal, firmForm);
        show('Фирма обновлена');
      }
      closeEdit();
      loadFirms();
      onChanged?.();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeFirm = async (firmId) => {
    if (!canEdit) return;
    if (!window.confirm('Удалить фирму?')) return;
    try {
      await api.deleteCounterpartyFirm(counterpartyId, firmId);
      loadFirms();
      onChanged?.();
      show('Фирма удалена');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const openContractCreate = () => {
    setContractForm(emptyContract);
    setContractModalOpen(true);
  };

  const saveContract = async () => {
    if (!canEdit) return;
    if (!String(contractForm.number || '').trim()) {
      show('Укажите номер договора', 'error');
      return;
    }
    setContractSaving(true);
    try {
      const created = await api.createCounterpartyContract(counterpartyId, {
        title: contractForm.title.trim() || null,
        number: contractForm.number.trim(),
        date: contractForm.date || null,
        end_date: contractForm.end_date || null,
        direction: contractForm.direction || null,
        amount: contractForm.amount === '' ? 0 : Number(contractForm.amount),
      });
      await loadContracts();
      onContractsChanged?.();
      setFirmForm((prev) => ({ ...prev, contract_id: created.id }));
      setContractModalOpen(false);
      setContractForm(emptyContract);
      show('Договор создан и выбран');
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setContractSaving(false);
    }
  };

  return createPortal(
    <>
      {Toast}
      <Modal
        title="Фирмы для оплаты"
        onClose={onClose}
        footer={(
          <>
            <ModalCancelButton>Закрыть</ModalCancelButton>
            {canEdit && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                + Добавить фирму
              </button>
            )}
          </>
        )}
      >
        <p className="text-muted cp-contracts-hint">
          Юрлица и ИНН для банковских платежей. Выписка и акт сверки сопоставляются по ИНН фирмы.
        </p>

        {loading ? (
          <p className="text-muted">Загрузка…</p>
        ) : firms.length > 0 ? (
          <div className="table-wrap cp-contracts-table">
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>ИНН</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {firms.map((f) => (
                  <tr
                    key={f.id}
                    className={canEdit ? 'cp-firm-row' : undefined}
                    onClick={canEdit ? () => openEdit(f) : undefined}
                  >
                    <td>{f.name}{f.is_default ? ' · основная' : ''}</td>
                    <td>{f.inn || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <div className="btn-group btn-group-icons">
                          <IconButton title="Изменить" onClick={() => openEdit(f)}>
                            <IconEdit />
                          </IconButton>
                          {!f.is_used && (
                            <IconButton title="Удалить" danger onClick={() => removeFirm(f.id)}>
                              <IconTrash />
                            </IconButton>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">Фирмы не добавлены.</p>
        )}
      </Modal>

      {editModal && (
        <Modal
          title={editModal === 'create' ? 'Новая фирма' : 'Редактировать фирму'}
          dirty={isFirmDirty}
          onClose={closeEdit}
          footer={(
            <>
              <ModalCancelButton disabled={saving} />
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveFirm}
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
                value={firmForm.name}
                onChange={(e) => setFirmForm({ ...firmForm, name: e.target.value })}
                placeholder="OOO FARXOD KREDIT"
              />
            </div>
            <div className="form-group">
              <label>ИНН</label>
              <input
                value={firmForm.inn}
                onChange={(e) => setFirmForm({
                  ...firmForm,
                  inn: e.target.value.replace(/\D/g, '').slice(0, 9),
                })}
                placeholder="206753636"
                inputMode="numeric"
                maxLength={9}
              />
            </div>
            <div className="form-group">
              <label>МФО</label>
              <input
                value={firmForm.mfo}
                onChange={(e) => setFirmForm({
                  ...firmForm,
                  mfo: e.target.value.replace(/\D/g, '').slice(0, 5),
                })}
                placeholder="00444"
                inputMode="numeric"
                maxLength={5}
              />
            </div>
            <div className="form-group full">
              <label>Банковский счёт</label>
              <input
                value={firmForm.bank_account}
                onChange={(e) => setFirmForm({
                  ...firmForm,
                  bank_account: e.target.value.replace(/\D/g, '').slice(0, 20),
                })}
                placeholder="20208000000000000000"
                inputMode="numeric"
                maxLength={20}
              />
            </div>
            <div className="form-group full">
              <label>Договор</label>
              <div className="quick-add-control">
                <select
                  value={firmForm.contract_id}
                  onChange={(e) => setFirmForm({ ...firmForm, contract_id: e.target.value })}
                >
                  <option value="">— не выбран —</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>{formatContractOptionLabel(c)}</option>
                  ))}
                </select>
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost quick-add-button"
                    title="Создать договор"
                    aria-label="Создать договор"
                    onClick={openContractCreate}
                  >
                    <IconPlus />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {contractModalOpen && (
        <Modal
          title="Новый договор"
          dirty={isContractDirty}
          onClose={() => {
            setContractModalOpen(false);
            setContractForm(emptyContract);
          }}
          footer={(
            <>
              <ModalCancelButton disabled={contractSaving} />
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveContract}
                disabled={contractSaving}
              >
                {contractSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </>
          )}
        >
          <div className="form-grid">
            <div className="form-group full">
              <label>Название</label>
              <input
                value={contractForm.title}
                onChange={(e) => setContractForm({ ...contractForm, title: e.target.value })}
                placeholder="Договор поставки"
              />
            </div>
            <div className="form-group">
              <label>Номер</label>
              <input
                value={contractForm.number}
                onChange={(e) => setContractForm({ ...contractForm, number: e.target.value })}
                placeholder="№ 123/2026"
              />
            </div>
            <div className="form-group">
              <label>Дата</label>
              <input
                type="date"
                value={contractForm.date}
                onChange={(e) => setContractForm({ ...contractForm, date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Входящий / исходящий</label>
              <select
                value={contractForm.direction}
                onChange={(e) => setContractForm({ ...contractForm, direction: e.target.value })}
              >
                <option value="outgoing">Исходящий</option>
                <option value="incoming">Входящий</option>
              </select>
            </div>
            <div className="form-group">
              <label>Сумма договора</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={contractForm.amount}
                onChange={(e) => setContractForm({ ...contractForm, amount: e.target.value })}
                placeholder="0"
              />
            </div>
            <div className="form-group full">
              <label>Срок окончания</label>
              <input
                type="date"
                value={contractForm.end_date}
                onChange={(e) => setContractForm({ ...contractForm, end_date: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </>,
    document.body,
  );
}
