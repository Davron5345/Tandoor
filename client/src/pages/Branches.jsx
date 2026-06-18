import { useEffect, useState } from 'react';
import { api } from '../api';
import Modal, { useToast } from '../components/Modal';
import { useBranch } from '../BranchContext';

const empty = { id: '', name: '', address: '', phone: '', active: true };

export default function Branches() {
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const { reloadBranches } = useBranch();
  const { show, Toast } = useToast();

  const load = () => {
    api.getBranches().then(setList).catch(console.error);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({ ...empty });
    setModal('create');
  };

  const openEdit = (b) => {
    setForm({
      id: b.id,
      name: b.name,
      address: b.address || '',
      phone: b.phone || '',
      active: !!b.active,
    });
    setModal('edit');
  };

  const save = async () => {
    try {
      if (modal === 'create') {
        await api.createBranch(form);
        show('Филиал добавлен');
      } else {
        await api.updateBranch(form.id, form);
        show('Филиал обновлён');
      }
      setModal(null);
      load();
      reloadBranches();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (b) => {
    if (b.id === 'main') return;
    if (!window.confirm(`Удалить филиал «${b.name}»?`)) return;
    try {
      await api.deleteBranch(b.id);
      show('Филиал удалён');
      load();
      reloadBranches();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Филиалы</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>+ Добавить филиал</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Код</th>
                <th>Адрес</th>
                <th>Телефон</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong></td>
                  <td><code>{b.id}</code></td>
                  <td>{b.address || '—'}</td>
                  <td>{b.phone || '—'}</td>
                  <td>
                    <span className={`badge badge-${b.active ? 'confirmed' : 'cancelled'}`}>
                      {b.active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td>
                    <div className="btn-group">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(b)}>Изменить</button>
                      {b.id !== 'main' && (
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(b)}>Удалить</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Новый филиал' : 'Редактировать филиал'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            {modal === 'create' && (
              <div className="form-group">
                <label>Код *</label>
                <input
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  placeholder="filial1"
                />
                <small style={{ color: 'var(--text-muted)' }}>Латиница, цифры, _ — например: filial1, samarkand</small>
              </div>
            )}
            <div className="form-group">
              <label>Название *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Адрес</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Телефон</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            {modal === 'edit' && (
              <div className="form-group">
                <label>Статус</label>
                <select
                  value={form.active ? '1' : '0'}
                  onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
                  disabled={form.id === 'main'}
                >
                  <option value="1">Активен</option>
                  <option value="0">Отключён</option>
                </select>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
