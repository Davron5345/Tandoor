import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
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
import CounterpartyContractsModal from '../components/CounterpartyContractsModal';
import { useFormDirty } from '../hooks/useFormDirty';
import { hasPermission } from '../permissions';
import { textMatchesSearch } from '../utils/searchNormalize';
import SearchHighlight from '../components/SearchHighlight';

export default function Counterparties() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyCounterpartyForm);
  const [contracts, setContracts] = useState([]);
  const [firms, setFirms] = useState([]);
  const [firmsModalOpen, setFirmsModalOpen] = useState(false);
  const [contractsModalOpen, setContractsModalOpen] = useState(false);
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
      loadFirms(modal);
    } else {
      setContracts([]);
      setFirms([]);
      setFirmsModalOpen(false);
      setContractsModalOpen(false);
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

  const remove = async (id) => {
    if (!confirm('Удалить контрагента?')) return;
    await api.deleteCounterparty(id);
    show('Удалено');
    load();
  };

  const closeMainModal = () => {
    clearFormDraft(draftKey);
    setFirmsModalOpen(false);
    setContractsModalOpen(false);
    setModal(null);
  };

  const filteredItems = useMemo(() => {
    const q = search.trim();
    if (!q) return items;
    return items.filter((c) => (
      textMatchesSearch(c.name, q)
      || textMatchesSearch(c.inn, q)
      || textMatchesSearch(c.firms_label, q)
      || textMatchesSearch(c.phone, q)
    ));
  }, [items, search]);

  return (
    <div className="cp-page">
      {Toast}
      <div className="page-header">
        <h1>Контрагенты</h1>
        <div className="btn-group">
          <BranchChip>{branchName}</BranchChip>
          {canEdit && <button className="btn btn-primary" onClick={openCreate}>+ Добавить</button>}
        </div>
      </div>

      <div className="filters">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по названию, ИНН, телефону…"
          aria-label="Поиск контрагентов"
        />
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
                <th className="num" title="Складские документы + операции банка">Упоминания</th>
                <th>Телефон</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    {items.length === 0 ? 'Нет контрагентов' : 'Ничего не найдено'}
                  </td>
                </tr>
              ) : filteredItems.map((c, index) => (
                <tr key={c.id}>
                  <td className="col-index muted">{index + 1}</td>
                  <td><SearchHighlight text={c.name} query={search} /></td>
                  <td><SearchHighlight text={c.firms_label || c.inn || '—'} query={search} /></td>
                  <td>
                    <span className={`badge badge-${c.type}`}>
                      {c.type === 'supplier' ? 'Поставщик' : 'Клиент'}
                    </span>
                  </td>
                  <td
                    className="num"
                    title={`Документы: ${c.documents_count || 0} · Выписки/оплаты: ${c.payments_count || 0}`}
                  >
                    {(c.mentions_count || 0) > 0 ? (
                      <span className="cp-mentions-count">{c.mentions_count}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                  <td>{c.phone ? formatUzPhone(c.phone) : '—'}</td>
                  <td>
                    {canEdit ? (
                      <div className="btn-group btn-group-icons">
                        <IconButton title="Изменить" onClick={() => openEdit(c)}>
                          <IconEdit />
                        </IconButton>
                        {(c.mentions_count || 0) === 0 ? (
                          <IconButton title="Удалить" danger onClick={() => remove(c.id)}>
                            <IconTrash />
                          </IconButton>
                        ) : (
                          <IconButton
                            title={`Нельзя удалить: есть упоминания (${c.mentions_count})`}
                            disabled
                          >
                            <IconTrash />
                          </IconButton>
                        )}
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
          className="modal-cp"
          dirty={isFormDirty}
          footerPlacement="end"
          onClose={closeMainModal}
          footer={(
            <>
              <ModalCancelButton />
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          )}
        >
          <CounterpartyFormFields form={form} setForm={setForm} />

          {modal !== 'create' && (
            <div className="cp-links-block">
              {(form.type === 'supplier' || form.type === 'client') && (
                <div className="cp-link-row">
                  <div className="cp-link-text">
                    <strong>{form.type === 'client' ? 'Каналы' : 'Фирмы'}</strong>
                    <span className="text-muted">
                      {firms.length > 0
                        ? firms.map((f) => f.name).join(', ')
                        : (form.type === 'client'
                          ? 'Click / Payme / Терминал / Humo…'
                          : 'юрлица, ИНН и договоры')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setFirmsModalOpen(true)}
                  >
                    {firms.length > 0
                      ? `${form.type === 'client' ? 'Каналы' : 'Фирмы'} (${firms.length})`
                      : 'Добавить'}
                  </button>
                </div>
              )}
              {form.type === 'client' && (
                <div className="cp-link-row">
                  <div className="cp-link-text">
                    <strong>Договоры</strong>
                    <span className="text-muted">
                      {contracts.length > 0
                        ? contracts.map((c) => c.title || c.number).join(', ')
                        : 'привязка к каналам'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setContractsModalOpen(true)}
                  >
                    {contracts.length > 0 ? `Договоры (${contracts.length})` : 'Добавить'}
                  </button>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {firmsModalOpen && modal && modal !== 'create' && (form.type === 'supplier' || form.type === 'client') && (
        <CounterpartyFirmsModal
          counterpartyId={modal}
          canEdit={canEdit}
          title={form.type === 'client' ? 'Каналы оплаты' : 'Фирмы поставщика'}
          onClose={() => setFirmsModalOpen(false)}
          onChanged={() => {
            loadFirms(modal);
            load();
          }}
          onContractsChanged={() => loadContracts(modal)}
        />
      )}

      {contractsModalOpen && modal && modal !== 'create' && form.type === 'client' && (
        <CounterpartyContractsModal
          counterpartyId={modal}
          counterpartyType={form.type}
          canEdit={canEdit}
          onClose={() => setContractsModalOpen(false)}
          onChanged={() => loadContracts(modal)}
        />
      )}
    </div>
  );
}
