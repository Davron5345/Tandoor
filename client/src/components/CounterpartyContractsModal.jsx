import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, formatDate, formatPriceInput } from '../api';
import Modal, { ModalCancelButton, useToast } from './Modal';
import { IconButton, IconEdit, IconTrash } from './ActionIcons';
import ContractEditModal from './ContractEditModal';

export default function CounterpartyContractsModal({
  counterpartyId,
  counterpartyType = 'supplier',
  firmId = null,
  firmName = '',
  canEdit,
  onClose,
  onChanged,
}) {
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contractEditor, setContractEditor] = useState(null);
  const { show, Toast } = useToast();

  const loadContracts = useCallback(() => {
    if (!counterpartyId) {
      setContracts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = firmId ? { firm_id: firmId } : undefined;
    api.getCounterpartyContracts(counterpartyId, params)
      .then((list) => setContracts(list.filter((c) => c.id !== '__default__' && !c.virtual)))
      .catch(() => setContracts([]))
      .finally(() => setLoading(false));
  }, [counterpartyId, firmId]);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  const removeContract = async (contractId) => {
    if (!canEdit) return;
    if (!window.confirm('Удалить договор?')) return;
    try {
      await api.deleteCounterpartyContract(counterpartyId, contractId);
      loadContracts();
      onChanged?.();
      show('Договор удалён');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const title = firmName
    ? `Договоры · ${firmName}`
    : 'Договоры';

  return createPortal(
    <>
      {Toast}
      <Modal
        title={title}
        onClose={onClose}
        footer={(
          <>
            <ModalCancelButton>Закрыть</ModalCancelButton>
            {canEdit && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setContractEditor({ id: null, initial: null })}
              >
                + Добавить договор
              </button>
            )}
          </>
        )}
      >
        <p className="text-muted cp-contracts-hint">
          {firmId
            ? 'Договоры этой фирмы. Используются в приходе и оплатах.'
            : (counterpartyType === 'client'
              ? 'Для эквайринга создайте договоры Click, Payme, Терминал.'
              : 'Если договоров нет, в приходе используется «Основной договор».')}
        </p>

        {loading ? (
          <p className="text-muted">Загрузка…</p>
        ) : contracts.length > 0 ? (
          <div className="table-wrap cp-contracts-table">
            <table className="cp-contracts-compact-table">
              <thead>
                <tr>
                  <th>Название / №</th>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Сумма</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div>{c.title || c.number}</div>
                      {c.title && c.number && c.title !== c.number && (
                        <div className="text-muted" style={{ fontSize: 12 }}>{c.number}</div>
                      )}
                    </td>
                    <td>{c.date ? formatDate(c.date) : '—'}</td>
                    <td>
                      {c.direction === 'incoming'
                        ? 'Вход.'
                        : (c.direction === 'outgoing' ? 'Исх.' : '—')}
                    </td>
                    <td>{c.amount ? formatPriceInput(Math.round(Number(c.amount))) : '—'}</td>
                    <td>
                      {canEdit && (
                        <div className="btn-group btn-group-icons">
                          <IconButton
                            title="Изменить"
                            onClick={() => setContractEditor({ id: c.id, initial: c })}
                          >
                            <IconEdit />
                          </IconButton>
                          {!c.is_used && (
                            <IconButton title="Удалить" danger onClick={() => removeContract(c.id)}>
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
          <p className="text-muted">Договоры не добавлены.</p>
        )}
      </Modal>

      <ContractEditModal
        open={Boolean(contractEditor)}
        counterpartyId={counterpartyId}
        firmId={firmId}
        contractId={contractEditor?.id || null}
        initial={contractEditor?.initial || null}
        onClose={() => setContractEditor(null)}
        onSaved={() => {
          loadContracts();
          onChanged?.();
        }}
      />
    </>,
    document.body,
  );
}
