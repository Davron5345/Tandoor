import { useEffect, useState } from 'react';
import { api } from '../api';
import Modal, { useToast } from '../components/Modal';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const empty = { id: '', branch_id: '', name: '', active: true };

export default function Departments() {
  const [list, setList] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const { branches, branchId } = useBranch();
  const activeBranches = branches.filter((b) => b.active);
  const { show, Toast } = useToast();

  const load = () => {
    api.getDepartments().then(setList).catch(console.error);
  };

  useEffect(() => { load(); }, [branchId]);
  useAutoRefresh(load, [branchId], { enabled: !modal });

  const openCreate = () => {
    setForm({ ...empty, branch_id: branchId || activeBranches[0]?.id || 'main' });
    setModal('create');
  };

  const openEdit = (d) => {
    setForm({
      id: d.id,
      branch_id: d.branch_id,
      name: d.name,
      active: !!d.active,
    });
    setModal('edit');
  };

  const save = async () => {
    try {
      if (modal === 'create') {
        await api.createDepartment(form);
        show('Отдел добавлен');
      } else {
        await api.updateDepartment(form.id, form);
        show('Отдел обновлён');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (d) => {
    if (!window.confirm(`Удалить отдел «${d.name}»?`)) return;
    try {
      await api.deleteDepartment(d.id);
      show('Отдел удалён');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Отделы</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>+ Добавить отдел</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Филиал</th>
                <th>Код</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.branch_name || d.branch_id}</td>
                  <td><code>{d.id}</code></td>
                  <td>
                    <span className={`badge badge-${d.active ? 'confirmed' : 'cancelled'}`}>
                      {d.active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td>
                    <div className="btn-group">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(d)}>Изменить</button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(d)}>Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={5} className="empty">Отделы не найдены</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Новый отдел' : 'Редактировать отдел'}
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
                  placeholder="otdel1"
                />
                <small style={{ color: 'var(--text-muted)' }}>Латиница, цифры, _ — например: kuhnya, sklad</small>
              </div>
            )}
            <div className="form-group">
              <label>Филиал *</label>
              <select
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                disabled={modal === 'edit'}
              >
                {activeBranches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Название *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            {modal === 'edit' && (
              <div className="form-group">
                <label>Статус</label>
                <select
                  value={form.active ? '1' : '0'}
                  onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
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
