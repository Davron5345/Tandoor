import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import Modal, { ModalCancelButton, useToast } from './Modal';
import { IconButton, IconEdit, IconPlus, IconTrash } from './ActionIcons';
import { useFormDirty } from '../hooks/useFormDirty';
import ContractEditModal, { formatContractOptionLabel } from './ContractEditModal';

export { formatContractOptionLabel };

const emptyFirm = {
  name: '',
  inn: '',
  bank_account: '',
  mfo: '',
  contract_id: '',
  is_default: false,
};

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
  const [contractEditor, setContractEditor] = useState(null); // null | { id, initial }
  const { show, Toast } = useToast();
  const isFirmDirty = useFormDirty(firmForm, editModal ? `firm-${editModal}` : null);

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
    setContractEditor(null);
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

  const selectedContract = contracts.find((c) => c.id === firmForm.contract_id) || null;

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
                {canEdit && selectedContract && (
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost quick-add-button"
                    title="Редактировать договор"
                    aria-label="Редактировать договор"
                    onClick={() => setContractEditor({ id: selectedContract.id, initial: selectedContract })}
                  >
                    <IconEdit />
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="btn btn-icon btn-ghost quick-add-button"
                    title="Создать договор"
                    aria-label="Создать договор"
                    onClick={() => setContractEditor({ id: null, initial: null })}
                  >
                    <IconPlus />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      <ContractEditModal
        open={Boolean(contractEditor)}
        counterpartyId={counterpartyId}
        contractId={contractEditor?.id || null}
        initial={contractEditor?.initial || null}
        onClose={() => setContractEditor(null)}
        onSaved={(saved) => {
          loadContracts();
          onContractsChanged?.();
          if (saved?.id) {
            setFirmForm((prev) => ({ ...prev, contract_id: saved.id }));
          }
        }}
      />
    </>,
    document.body,
  );
}
