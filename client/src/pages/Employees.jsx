import { useEffect, useState } from 'react';
import { api } from '../api';
import Modal, { useToast } from '../components/Modal';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';

const emptyUser = { username: '', password: '', name: '', role: 'warehouse', branch_id: 'main', active: true };

export default function Employees() {
  const { user } = useAuth();
  const { branches, branchId } = useBranch();
  const canEdit = hasPermission(user, 'users.edit');

  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState({});
  const [userModal, setUserModal] = useState(null);
  const [userForm, setUserForm] = useState(emptyUser);
  const { show, Toast } = useToast();

  const activeBranches = branches.filter((b) => b.active);

  const load = () => {
    api.getUsers().then(setUsers).catch(console.error);
    api.getRoles().then(setRoles).catch(console.error);
  };

  useEffect(() => { load(); }, [branchId]);

  const openCreateUser = () => {
    const defaultRole = Object.keys(roles).find((k) => k !== 'admin') || 'warehouse';
    setUserForm({
      ...emptyUser,
      password: '',
      role: defaultRole,
      branch_id: activeBranches[0]?.id || 'main',
    });
    setUserModal('create');
  };

  const openEditUser = (u) => {
    setUserForm({
      username: u.username,
      password: '',
      name: u.name,
      role: u.role,
      branch_id: u.branch_id || 'main',
      active: u.active,
      protected: !!u.protected,
    });
    setUserModal(u.id);
  };

  const isProtectedForm = userForm.protected || userForm.username?.toLowerCase() === 'admin';

  const saveUser = async () => {
    try {
      const payload = { ...userForm };
      if (payload.role === 'admin') {
        payload.branch_id = null;
      } else if (!payload.branch_id) {
        show('Укажите филиал', 'error');
        return;
      }
      if (userModal === 'create') {
        if (!userForm.password) {
          show('Укажите пароль', 'error');
          return;
        }
        await api.createUser(payload);
        show('Сотрудник добавлен');
      } else {
        if (!payload.password) delete payload.password;
        if (isProtectedForm) {
          delete payload.role;
          delete payload.username;
          delete payload.active;
          delete payload.branch_id;
        }
        await api.updateUser(userModal, payload);
        show('Сотрудник обновлён');
      }
      setUserModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Удалить сотрудника «${u.name}»?`)) return;
    try {
      await api.deleteUser(u.id);
      show('Удалено');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Сотрудники</h1>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreateUser}>+ Добавить сотрудника</button>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Логин</th>
                <th>Роль</th>
                <th>Филиал</th>
                <th>Статус</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.username}</td>
                  <td>
                    <span className="badge badge-supplier">
                      {roles[u.role]?.label || u.role}
                      {u.protected && ' ★'}
                    </span>
                  </td>
                  <td>{u.role === 'admin' ? 'Все филиалы' : (u.branch_name || '—')}</td>
                  <td>
                    <span className={`badge badge-${u.active ? 'confirmed' : 'cancelled'}`}>
                      {u.active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  {canEdit && (
                    <td>
                      <div className="btn-group">
                        <button className="btn btn-ghost btn-sm" onClick={() => openEditUser(u)}>Изменить</button>
                        {!(u.protected || u.username === 'admin') && (
                          <button className="btn btn-danger btn-sm" onClick={() => removeUser(u)}>Удалить</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {userModal && (
        <Modal
          title={userModal === 'create' ? 'Новый сотрудник' : 'Редактировать сотрудника'}
          onClose={() => setUserModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setUserModal(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={saveUser}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            {isProtectedForm && userModal !== 'create' && (
              <p className="form-hint" style={{ gridColumn: '1 / -1' }}>
                Главный администратор — роль, логин и статус изменить нельзя. Можно менять имя и пароль.
              </p>
            )}
            <div className="form-group">
              <label>Имя *</label>
              <input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Логин *</label>
              <input
                value={userForm.username}
                onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                disabled={isProtectedForm && userModal !== 'create'}
              />
            </div>
            <div className="form-group">
              <label>Роль *</label>
              <select
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                disabled={isProtectedForm && userModal !== 'create'}
              >
                {Object.entries(roles).map(([k, r]) => (
                  <option key={k} value={k}>{r.label}</option>
                ))}
              </select>
            </div>
            {userForm.role !== 'admin' && (
              <div className="form-group">
                <label>Филиал *</label>
                <select
                  value={userForm.branch_id || ''}
                  onChange={(e) => setUserForm({ ...userForm, branch_id: e.target.value })}
                >
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>{userModal === 'create' ? 'Пароль *' : 'Новый пароль'}</label>
              <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} placeholder={userModal === 'create' ? '' : 'Оставьте пустым, чтобы не менять'} />
            </div>
            <div className="form-group">
              <label>Статус</label>
              <select
                value={userForm.active ? '1' : '0'}
                onChange={(e) => setUserForm({ ...userForm, active: e.target.value === '1' })}
                disabled={isProtectedForm && userModal !== 'create'}
              >
                <option value="1">Активен</option>
                <option value="0">Отключён</option>
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
