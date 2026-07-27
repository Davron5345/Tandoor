import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate, formatPriceInput } from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import CounterpartyFormFields, { emptyCounterpartyForm } from '../components/CounterpartyFormFields';
import { IconButton, IconEdit, IconTrash } from '../components/ActionIcons';
import { formatUzPhone } from '../phoneFormat';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import {
  useFormDraft,
  formDraftKey,
  readFormDraft,
  clearFormDraft,
  promptRestoreDraft,
} from '../hooks/useFormDraft';
import CounterpartyFirmsModal from '../components/CounterpartyFirmsModal';
import ContractEditModal from '../components/ContractEditModal';
import { useFormDirty } from '../hooks/useFormDirty';
import { hasPermission } from '../permissions';

export default function Counterparties() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyCounterpartyForm);
  const [contracts, setContracts] = useState([]);
  const [firms, setFirms] = useState([]);
  const [firmsModalOpen, setFirmsModalOpen] = useState(false);
  const [contractEditor, setContractEditor] = useState(null); // null | { id, initial }
  const draftKey = formDraftKey('counterparties', modal);
  const draftPayload = useMemo(() => ({ form }), [form]);
  useFormDraft(draftKey, draftPayload, Boolean(modal));
  const isFormDirty = useFormDirty(draftPayload, draftKey);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const canEdit = hasPermission(user, 'counterparties.edit');

  const load = useCallback(
    () => api.getCounterparties(filter || undefined).then(setItems).catch(console.error),
    [filter, branchId],
  );
  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId], { enabled: !modal });

  const loadContracts = (counterpartyId) => {
    if (!counterpartyId) {
      setContracts([]);
      return;
    }
    api.getCounterpartyContracts(counterpartyId)
      .then((list) => setContracts(list.filter((c) => c.id !== '__default__' && !c.virtual)))
      .catch(() => setContracts([]));
  };

  const loadFirms = (counterpartyId) => {
    if (!counterpartyId) {
      setFirms([]);
      return;
    }
    api.getCounterpartyFirms(counterpartyId)
      .then(setFirms)
      .catch(() => setFirms([]));
  };

  useEffect(() => {
    if (modal && modal !== 'create') {
      loadContracts(modal);
      if (form.type === 'supplier') loadFirms(modal);
      else setFirms([]);
    } else {
      setContracts([]);
      setFirms([]);
      setFirmsModalOpen(false);
      setContractEditor(null);
    }
  }, [modal, form.type, branchId]);

  const openCreate = () => {
    const key = formDraftKey('counterparties', 'create');
    const draft = readFormDraft(key);
    if (draft?.form && promptRestoreDraft(draft, 'черновик контрагента')) {
      setForm(draft.form);
    } else {
      if (draft) clearFormDraft(key);
      setForm(emptyCounterpartyForm);
    }
    setModal('create');
  };
  const openEdit = (c) => {
    const baseForm = {
      ...c,
      phone: c.phone ? formatUzPhone(c.phone) : '',
      opening_balance: c.opening_balance || 0,
    };
    const key = formDraftKey('counterparties', c.id);
    const draft = readFormDraft(key);
    if (draft?.form && promptRestoreDraft(draft, 'черновик контрагента')) {
      setForm(draft.form);
    } else {
      if (draft) clearFormDraft(key);
      setForm(baseForm);
    }
    setModal(c.id);
  };

  const save = async () => {
    try {
      if (modal === 'create') {
        await api.createCounterparty(form);
        show('Контрагент добавлен');
      } else {
        await api.updateCounterparty(modal, form);
        show('Контрагент обновлён');
      }
      clearFormDraft(draftKey);
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const removeContract = async (contractId) => {
    if (!canEdit || modal === 'create') return;
    if (!window.confirm('Удалить договор?')) return;
    try {
      await api.deleteCounterpartyContract(modal, contractId);
      loadContracts(modal);
      show('Договор удалён');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Удалить контрагента?')) return;
    await api.deleteCounterparty(id);
    show('Удалено');
    load();
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Контрагенты</h1>
        <div className="btn-group">
          <BranchChip>{branchName}</BranchChip>
          {canEdit && <button className="btn btn-primary" onClick={openCreate}>+ Добавить</button>}
        </div>
      </div>

      <div className="filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Все</option>
          <option value="supplier">Поставщики</option>
          <option value="client">Клиенты</option>
        </select>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="col-index">№</th>
                <th>Название</th>
                <th>Фирмы / ИНН</th>
                <th>Тип</th>
                <th>Телефон</th>
                <th>Telegram ID</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c, index) => (
                <tr key={c.id}>
                  <td className="col-index muted">{index + 1}</td>
                  <td>{c.name}</td>
                  <td>{c.firms_label || c.inn || '—'}</td>
                  <td>
                    <span className={`badge badge-${c.type}`}>
                      {c.type === 'supplier' ? 'Поставщик' : 'Клиент'}
                    </span>
                  </td>
                  <td>{c.phone ? formatUzPhone(c.phone) : '—'}</td>
                  <td>{c.telegram_chat_id || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td>
                    {canEdit ? (
                      <div className="btn-group btn-group-icons">
                        <IconButton title="Изменить" onClick={() => openEdit(c)}>
                          <IconEdit />
                        </IconButton>
                        <IconButton title="Удалить" danger onClick={() => remove(c.id)}>
                          <IconTrash />
                        </IconButton>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Новый контрагент' : 'Редактировать контрагента'}
          dirty={isFormDirty}
          onClose={() => {
            clearFormDraft(draftKey);
            setFirmsModalOpen(false);
            setModal(null);
          }}
          footer={
            <>
              <ModalCancelButton />
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <CounterpartyFormFields form={form} setForm={setForm} />

          {modal !== 'create' && form.type === 'supplier' && (
            <div className="cp-contracts-block">
              <div className="cp-firms-summary">
                <h3>Фирмы для оплаты</h3>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setFirmsModalOpen(true)}
                >
                  {firms.length > 0 ? `Фирмы (${firms.length})` : 'Добавить фирмы'}
                </button>
              </div>
              {firms.length > 0 ? (
                <ul className="cp-firms-compact-list">
                  {firms.map((f) => (
                    <li key={f.id}>
                      {f.name}
                      {f.inn ? ` · ${f.inn}` : ''}
                      {f.is_default ? ' · основная' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted cp-contracts-hint">
                  Юрлица с ИНН для банковских платежей и акта сверки.
                </p>
              )}
            </div>
          )}

          {modal !== 'create' && (
            <div className="cp-contracts-block">
              <h3>Договоры</h3>
              <p className="text-muted cp-contracts-hint">
                {form.type === 'client'
                  ? 'Для розничных поступлений создайте клиента «КЛИЕНТ» и договоры Click, Payme, Терминал — их подхватит загрузка банковской выписки.'
                  : 'Если договоров нет, в приходных документах используется «Основной договор».'}
              </p>
              {contracts.length > 0 && (
                <div className="table-wrap cp-contracts-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Название</th>
                        <th>Номер</th>
                        <th>Дата</th>
                        <th>Тип</th>
                        <th>Сумма</th>
                        <th>Срок</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => (
                        <tr key={c.id}>
                          <td>{c.title || '—'}</td>
                          <td>{c.number}</td>
                          <td>{c.date ? formatDate(c.date) : '—'}</td>
                          <td>
                            {c.direction === 'incoming'
                              ? 'Входящий'
                              : (c.direction === 'outgoing' ? 'Исходящий' : '—')}
                          </td>
                          <td>{c.amount ? formatPriceInput(Math.round(Number(c.amount))) : '—'}</td>
                          <td>{c.end_date ? formatDate(c.end_date) : '—'}</td>
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
              )}
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setContractEditor({ id: null, initial: null })}
                >
                  + Добавить договор
                </button>
              )}
            </div>
          )}
        </Modal>
      )}

      {firmsModalOpen && modal && modal !== 'create' && form.type === 'supplier' && (
        <CounterpartyFirmsModal
          counterpartyId={modal}
          contracts={contracts}
          canEdit={canEdit}
          onClose={() => setFirmsModalOpen(false)}
          onChanged={() => {
            loadFirms(modal);
            load();
          }}
          onContractsChanged={() => loadContracts(modal)}
        />
      )}

      {modal && modal !== 'create' && (
        <ContractEditModal
          open={Boolean(contractEditor)}
          counterpartyId={modal}
          contractId={contractEditor?.id || null}
          initial={contractEditor?.initial || null}
          onClose={() => setContractEditor(null)}
          onSaved={() => loadContracts(modal)}
        />
      )}
    </div>
  );
}
