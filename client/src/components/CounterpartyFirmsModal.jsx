import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import Modal, { ModalCancelButton, useToast } from './Modal';
import { IconButton, IconTrash } from './ActionIcons';

const emptyFirm = { name: '', inn: '', contract_id: '', is_default: false };

export default function CounterpartyFirmsModal({
  counterpartyId,
  contracts = [],
  canEdit,
  onClose,
  onChanged,
}) {
  const [firms, setFirms] = useState([]);
  const [newFirm, setNewFirm] = useState(emptyFirm);
  const [loading, setLoading] = useState(true);
  const { show, Toast } = useToast();

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

  useEffect(() => {
    loadFirms();
  }, [loadFirms]);

  const addFirm = async () => {
    if (!canEdit) return;
    try {
      await api.createCounterpartyFirm(counterpartyId, newFirm);
      setNewFirm(emptyFirm);
      loadFirms();
      onChanged?.();
      show('Фирма добавлена');
    } catch (e) {
      show(e.message, 'error');
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

  return createPortal(
    <>
      {Toast}
      <Modal
        title="Фирмы для оплаты"
        onClose={onClose}
        footer={<ModalCancelButton>Закрыть</ModalCancelButton>}
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
                  <th>Название юрлица</th>
                  <th>ИНН</th>
                  <th>Договор</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {firms.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}{f.is_default ? ' · основная' : ''}</td>
                    <td>{f.inn || '—'}</td>
                    <td>{f.contract_number || '—'}</td>
                    <td>
                      {canEdit && !f.is_used && (
                        <IconButton title="Удалить" danger onClick={() => removeFirm(f.id)}>
                          <IconTrash />
                        </IconButton>
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

        {canEdit && (
          <div className="form-grid cp-contracts-add">
            <div className="form-group">
              <label>Название юрлица</label>
              <input
                value={newFirm.name}
                onChange={(e) => setNewFirm({ ...newFirm, name: e.target.value })}
                placeholder="OOO FARXOD KREDIT"
              />
            </div>
            <div className="form-group">
              <label>ИНН</label>
              <input
                value={newFirm.inn}
                onChange={(e) => setNewFirm({ ...newFirm, inn: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                placeholder="206753636"
                inputMode="numeric"
                maxLength={9}
              />
            </div>
            <div className="form-group">
              <label>Договор</label>
              <select
                value={newFirm.contract_id}
                onChange={(e) => setNewFirm({ ...newFirm, contract_id: e.target.value })}
              >
                <option value="">— не выбран —</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>{c.number}</option>
                ))}
              </select>
            </div>
            <div className="form-group cp-contracts-add-btn">
              <label>&nbsp;</label>
              <button type="button" className="btn btn-secondary" onClick={addFirm}>
                + Добавить фирму
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>,
    document.body,
  );
}
