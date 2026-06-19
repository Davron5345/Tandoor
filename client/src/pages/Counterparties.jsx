import { useCallback, useEffect, useState } from 'react';
import { api, formatDate } from '../api';
import Modal, { useToast } from '../components/Modal';
import { IconButton, IconEdit, IconTrash } from '../components/ActionIcons';
import { formatUzPhone } from '../phoneFormat';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { hasPermission } from '../permissions';

const empty = { name: '', type: 'supplier', phone: '', email: '', telegram_chat_id: '', address: '', notes: '' };
const emptyContract = { number: '', date: '' };

export default function Counterparties() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [contracts, setContracts] = useState([]);
  const [newContract, setNewContract] = useState(emptyContract);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchId, branchName } = useBranch();
  const canEdit = hasPermission(user, 'counterparties.edit');

  const load = useCallback(
    () => api.getCounterparties(filter || undefined).then(setItems).catch(console.error),
    [filter],
  );
  useEffect(() => { load(); }, [load]);
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

  useEffect(() => {
    if (modal && modal !== 'create' && form.type === 'supplier') {
      loadContracts(modal);
    } else {
      setContracts([]);
      setNewContract(emptyContract);
    }
  }, [modal, form.type, branchId]);

  const openCreate = () => { setForm(empty); setModal('create'); };
  const openEdit = (c) => {
    setForm({
      ...c,
      phone: c.phone ? formatUzPhone(c.phone) : '',
    });
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
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const addContract = async () => {
    if (!canEdit || modal === 'create') return;
    try {
      await api.createCounterpartyContract(modal, newContract);
      setNewContract(emptyContract);
      loadContracts(modal);
      show('Договор добавлен');
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
          <span className="page-subtitle">📍 {branchName}</span>
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
                <th>Название</th>
                <th>Тип</th>
                <th>Телефон</th>
                <th>Telegram ID</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
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
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Название *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Тип *</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="supplier">Поставщик</option>
                <option value="client">Клиент</option>
              </select>
            </div>
            <div className="form-group">
              <label>Телефон</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: formatUzPhone(e.target.value) })}
                placeholder="+998-99-302-53-45"
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Telegram Chat ID</label>
              <input
                value={form.telegram_chat_id}
                onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })}
                placeholder="Получить через /start в боте"
              />
            </div>
            <div className="form-group full">
              <label>Адрес</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="form-group full">
              <label>Заметки</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          {modal !== 'create' && form.type === 'supplier' && (
            <div className="cp-contracts-block">
              <h3>Договоры</h3>
              <p className="text-muted cp-contracts-hint">
                Если договоров нет, в приходных документах используется «Основной договор».
              </p>
              {contracts.length > 0 && (
                <div className="table-wrap cp-contracts-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Номер</th>
                        <th>Дата</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => (
                        <tr key={c.id}>
                          <td>{c.number}</td>
                          <td>{c.date ? formatDate(c.date) : '—'}</td>
                          <td>
                            {canEdit && (
                              <IconButton title="Удалить" danger onClick={() => removeContract(c.id)}>
                                <IconTrash />
                              </IconButton>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {canEdit && (
                <div className="form-grid cp-contracts-add">
                  <div className="form-group">
                    <label>Номер договора</label>
                    <input
                      value={newContract.number}
                      onChange={(e) => setNewContract({ ...newContract, number: e.target.value })}
                      placeholder="№ 123/2026"
                    />
                  </div>
                  <div className="form-group">
                    <label>Дата договора</label>
                    <input
                      type="date"
                      value={newContract.date}
                      onChange={(e) => setNewContract({ ...newContract, date: e.target.value })}
                    />
                  </div>
                  <div className="form-group cp-contracts-add-btn">
                    <label>&nbsp;</label>
                    <button type="button" className="btn btn-secondary" onClick={addContract}>
                      + Добавить договор
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
