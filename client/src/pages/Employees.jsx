import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney } from '../api';
import Modal, { useToast } from '../components/Modal';
import CounterpartySearchSelect from '../components/CounterpartySearchSelect';
import { IconButton, IconCopy, IconEdit, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { hasPermission } from '../permissions';

const emptyUser = {
  username: '',
  password: '',
  name: '',
  role: 'warehouse',
  branch_id: 'main',
  department_id: '',
  active: true,
  payroll_employee_id: '',
};

function suggestUsername(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const given = parts[1] || parts[0] || '';
  return given
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9]/gi, '');
}

function employeeLoginUrl(user) {
  if (!user?.login_path) return '';
  return `${window.location.origin}${user.login_path}`;
}

function groupUsersByDepartment(users) {
  const groups = new Map();
  const withoutDept = [];
  for (const user of users) {
    if (user.department_id) {
      const key = `${user.branch_id || ''}::${user.department_id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title: user.department_name || 'Отдел',
          subtitle: user.branch_name || '',
          users: [],
        });
      }
      groups.get(key).users.push(user);
    } else {
      withoutDept.push(user);
    }
  }
  const sections = [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  if (withoutDept.length) {
    sections.push({
      key: 'none',
      title: 'Без отдела',
      subtitle: 'Касса, офис и роли без привязки к складу',
      users: withoutDept,
    });
  }
  return sections;
}

export default function Employees() {
  const { user } = useAuth();
  const { branches, branchId, isHeadquarters, branchName } = useBranch();
  const canEdit = hasPermission(user, 'users.edit');
  const fileRef = useRef(null);

  const [tab, setTab] = useState('access'); // access | payroll
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState({});
  const [departments, setDepartments] = useState([]);
  const [payrollData, setPayrollData] = useState({ departments: [], items: [], total_debt: 0 });
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [userModal, setUserModal] = useState(null);
  const [userForm, setUserForm] = useState(emptyUser);
  const { show, Toast } = useToast();

  const activeBranches = branches.filter((b) => b.active);

  const formDepartments = useMemo(() => {
    const bid = userForm.branch_id || branchId;
    return (departments || []).filter((d) => d.branch_id === bid && d.active !== false && d.active !== 0);
  }, [departments, userForm.branch_id, branchId]);

  const availableRoles = useMemo(() => {
    const targetBranch = userForm.role === 'admin' ? null : (userForm.branch_id || branchId);
    return Object.fromEntries(
      Object.entries(roles).filter(([id, meta]) => {
        if (id === 'admin') return isHeadquarters;
        if (!targetBranch) return true;
        return meta.branchId === targetBranch;
      }),
    );
  }, [roles, userForm.branch_id, userForm.role, branchId, isHeadquarters]);

  const sections = useMemo(() => groupUsersByDepartment(users), [users]);

  const payrollItems = useMemo(() => {
    const currentName = String(userForm.name || '').trim().toLowerCase();
    const takenNames = new Set(
      users
        .filter((u) => u.id !== userModal)
        .map((u) => String(u.name || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const takenIds = new Set(
      users
        .filter((u) => u.id !== userModal && u.payroll_employee_id)
        .map((u) => u.payroll_employee_id),
    );
    return (payrollData.items || []).filter((emp) => {
      if (!emp?.id || !emp.full_name) return false;
      const key = String(emp.full_name).trim().toLowerCase();
      if (userForm.payroll_employee_id && emp.id === userForm.payroll_employee_id) return true;
      if (currentName && key === currentName) return true;
      if (takenIds.has(emp.id)) return false;
      return !takenNames.has(key);
    });
  }, [payrollData.items, users, userModal, userForm.name, userForm.payroll_employee_id]);

  const payrollSelectItems = useMemo(
    () => payrollItems.map((emp) => ({
      id: emp.id,
      name: [emp.full_name, emp.position, emp.department].filter(Boolean).join(' · '),
    })),
    [payrollItems],
  );

  const load = () => {
    api.getUsers().then(setUsers).catch(console.error);
    api.getRoles().then(setRoles).catch(console.error);
    api.getDepartments().then(setDepartments).catch(() => setDepartments([]));
  };

  const loadPayroll = () => {
    setPayrollLoading(true);
    api.getPayrollEmployees()
      .then((data) => setPayrollData(data || { departments: [], items: [], total_debt: 0 }))
      .catch((err) => {
        console.error(err);
        setPayrollData({ departments: [], items: [], total_debt: 0 });
      })
      .finally(() => setPayrollLoading(false));
  };

  useEffect(() => { load(); }, [branchId]);
  useEffect(() => {
    if (tab === 'payroll' || userModal) loadPayroll();
  }, [tab, branchId, userModal]);
  useEffect(() => {
    if (!userModal || userModal === 'create' || userForm.payroll_employee_id) return;
    const name = String(userForm.name || '').trim().toLowerCase();
    if (!name) return;
    const match = (payrollData.items || []).find(
      (emp) => String(emp.full_name || '').trim().toLowerCase() === name,
    );
    if (match) {
      setUserForm((prev) => (
        prev.payroll_employee_id ? prev : { ...prev, payroll_employee_id: match.id }
      ));
    }
  }, [userModal, payrollData.items, userForm.name, userForm.payroll_employee_id]);
  useAutoRefresh(load, [branchId], { enabled: !userModal && tab === 'access' });

  const openCreateUser = () => {
    const defaultRole = Object.keys(roles).find((k) => k !== 'admin') || 'warehouse';
    setUserForm({
      ...emptyUser,
      password: '',
      role: defaultRole,
      branch_id: branchId || activeBranches[0]?.id || 'main',
      department_id: '',
      payroll_employee_id: '',
    });
    setUserModal('create');
  };

  const pickPayrollEmployee = (id) => {
    const emp = payrollItems.find((e) => e.id === id);
    if (!emp) {
      setUserForm((prev) => ({
        ...prev,
        payroll_employee_id: '',
        name: userModal === 'create' ? '' : prev.name,
      }));
      return;
    }
    const username = suggestUsername(emp.full_name);
    const deptMatch = formDepartments.find((d) => (
      d.name && emp.department
      && d.name.trim().toLowerCase() === String(emp.department).trim().toLowerCase()
    ));
    setUserForm((prev) => ({
      ...prev,
      payroll_employee_id: emp.id,
      name: emp.full_name,
      username: userModal === 'create'
        ? (prev.username && prev.payroll_employee_id ? username : (prev.username || username))
        : prev.username,
      department_id: deptMatch?.id || prev.department_id || '',
    }));
  };

  const openEditUser = (u) => {
    setUserForm({
      username: u.username,
      password: '',
      name: u.name,
      role: u.role,
      branch_id: u.branch_id || 'main',
      department_id: u.department_id || '',
      active: u.active,
      protected: !!u.protected,
      payroll_employee_id: u.payroll_employee_id || '',
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
        if (!userForm.name.trim()) {
          show('Выберите сотрудника из списка', 'error');
          return;
        }
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
        delete payload.protected;
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

  const copyLoginLink = async (u) => {
    const url = employeeLoginUrl(u);
    if (!url) {
      show('Ссылка ещё не создана — сохраните сотрудника', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      show('Ссылка скопирована. Откройте её на телефоне сотрудника.');
    } catch {
      window.prompt('Ссылка для входа с телефона', url);
    }
  };

  const rotateLoginLink = async (u) => {
    if (!window.confirm(`Старая ссылка «${u.name}» перестанет работать. Выдать новую?`)) return;
    try {
      const updated = await api.rotateUserLoginLink(u.id);
      show('Новая ссылка готова');
      load();
      await copyLoginLink(updated);
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const copyPayrollLink = async (emp) => {
    const url = emp?.view_path ? `${window.location.origin}${emp.view_path}` : '';
    if (!url) {
      show('Ссылка ещё не создана', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      show(emp.has_login
        ? 'Ссылка скопирована. По ней сотрудник войдёт в систему.'
        : 'Ссылка скопирована. По ней сотрудник увидит долг и рейтинг.');
    } catch {
      window.prompt('Личная ссылка сотрудника', url);
    }
  };

  const rotatePayrollLink = async (emp) => {
    if (!window.confirm(`Старая ссылка «${emp.full_name}» перестанет работать. Выдать новую?`)) return;
    try {
      const updated = await api.rotatePayrollViewLink(emp.id);
      show('Новая ссылка готова');
      loadPayroll();
      await copyPayrollLink(updated);
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const onPickPayrollExcel = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportBusy(true);
    try {
      const scope = isHeadquarters ? 'all' : 'branch';
      const result = await api.importPayrollEmployeesXlsx(file, { scope });
      const parts = [
        `Строк: ${result.total_rows || 0}`,
        `новых: ${result.created || 0}`,
        `обновлено: ${result.updated || 0}`,
      ];
      if (result.skipped) parts.push(`пропущено: ${result.skipped}`);
      show(parts.join(', '));
      setTab('payroll');
      loadPayroll();
    } catch (err) {
      show(err.message || 'Ошибка импорта', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Сотрудники</h1>
        <div className="btn-group">
          {canEdit && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={importBusy}
                onClick={() => fileRef.current?.click()}
              >
                {importBusy ? 'Импорт…' : 'Импорт Excel'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={onPickPayrollExcel}
              />
            </>
          )}
          {canEdit && tab === 'access' && (
            <button type="button" className="btn btn-primary" onClick={openCreateUser}>+ Добавить сотрудника</button>
          )}
        </div>
      </div>

      <div className="section-tabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`section-tab${tab === 'access' ? ' is-active' : ''}`}
          onClick={() => setTab('access')}
        >
          Вход в систему
        </button>
        <button
          type="button"
          className={`section-tab${tab === 'payroll' ? ' is-active' : ''}`}
          onClick={() => setTab('payroll')}
        >
          Зарплата / Face ID
        </button>
      </div>

      {tab === 'access' && (
        <>
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Одна ссылка на человека. Если выдали вход в систему (вкладка «Вход в систему») — по ссылке открывается работа.
            Если логина нет — только личный кабинет: рейтинг явки и долг.
          </p>
          {!isHeadquarters && (
            <p className="form-hint" style={{ marginBottom: 12 }}>
              Показаны сотрудники филиала «{branchName}». Переключите на Asosiy, чтобы видеть всех.
            </p>
          )}

          {sections.map((section) => (
            <div className="card" key={section.key} style={{ marginBottom: 16 }}>
              <div className="card-header">
                <strong>{section.title}</strong>
                {section.subtitle && <span className="report-meta">{section.subtitle}</span>}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Имя</th>
                      <th>Логин</th>
                      <th>Роль</th>
                      <th>Филиал</th>
                      <th>Статус</th>
                      <th>Вход с телефона</th>
                      {canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {section.users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.username}</td>
                        <td>
                          <span className="badge badge-supplier">
                            {roles[u.role]?.label || u.roleLabel || u.role}
                            {u.protected && ' ★'}
                          </span>
                        </td>
                        <td>{u.role === 'admin' ? 'Все филиалы' : (u.branch_name || '—')}</td>
                        <td>
                          <span className={`badge badge-${u.active ? 'confirmed' : 'cancelled'}`}>
                            {u.active ? 'Активен' : 'Отключён'}
                          </span>
                        </td>
                        <td>
                          <div className="btn-group">
                            <IconButton title="Скопировать ссылку" onClick={() => copyLoginLink(u)} disabled={!u.login_path}>
                              <IconCopy />
                            </IconButton>
                            {canEdit && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => rotateLoginLink(u)}
                                title="Выдать новую ссылку"
                              >
                                Новая
                              </button>
                            )}
                          </div>
                        </td>
                        {canEdit && (
                          <td>
                            <div className="btn-group">
                              <IconButton title="Изменить" onClick={() => openEditUser(u)}>
                                <IconEdit />
                              </IconButton>
                              {!(u.protected || u.username === 'admin') && (
                                <IconButton title="Удалить" danger onClick={() => removeUser(u)}>
                                  <IconTrash />
                                </IconButton>
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
          ))}
          {users.length === 0 && (
            <div className="card"><div className="empty">Сотрудников пока нет</div></div>
          )}
        </>
      )}

      {tab === 'payroll' && (
        <>
          <p className="form-hint" style={{ marginBottom: 12 }}>
            Одна ссылка на каждого. Без логина в систему — кабинет (долг и рейтинг). С логином — работа в кассе/складе.
            Импорт Excel — шаблон Face ID (колонки Фирма, Отдел, Должность, ФИО, Оклад…).
            {isHeadquarters
              ? ' Фирма в файле сопоставляется с филиалом (при отсутствии филиал создаётся).'
              : ` В этот филиал («${branchName}») попадут только строки с совпадающей фирмой.`}
          </p>
          {payrollLoading ? (
            <div className="card"><div className="empty">Загрузка…</div></div>
          ) : (payrollData.departments || []).length === 0 ? (
            <div className="card">
              <div className="empty">
                Нет сотрудников зарплаты. Нажмите «Импорт Excel» или синхронизируйте Face ID на кассе.
              </div>
            </div>
          ) : (
            (payrollData.departments || []).map((dep) => (
              <div className="card" key={dep.name} style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <strong>{dep.name || 'Без отдела'}</strong>
                  <span className="report-meta">
                    {dep.employees?.length || 0} чел.
                    {Number(dep.debt_sum) > 0 ? ` · долг ${formatMoney(dep.debt_sum)}` : ''}
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>№</th>
                        <th>ФИО</th>
                        <th>Должность</th>
                        <th>Оклад</th>
                        <th>Долг</th>
                        <th>Доступ</th>
                        <th>Ссылка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dep.employees || []).map((emp, idx) => (
                        <tr key={emp.id}>
                          <td>{idx + 1}</td>
                          <td>{emp.full_name}</td>
                          <td>{emp.position || '—'}</td>
                          <td>{Number(emp.base_salary) > 0 ? formatMoney(emp.base_salary) : '—'}</td>
                          <td>{Number(emp.balance) > 0 ? formatMoney(emp.balance) : '—'}</td>
                          <td>{emp.has_login ? 'Вход в систему' : 'Только кабинет'}</td>
                          <td>
                            <div className="btn-group">
                              <IconButton
                                title={emp.has_login ? 'Скопировать ссылку входа' : 'Скопировать ссылку кабинета'}
                                onClick={() => copyPayrollLink(emp)}
                                disabled={!emp.view_path}
                              >
                                <IconCopy />
                              </IconButton>
                              {canEdit && (
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => rotatePayrollLink(emp)}
                                  title="Выдать новую ссылку"
                                >
                                  Новая
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </>
      )}

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
            {userModal && !isProtectedForm && (
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>{userModal === 'create' ? 'Сотрудник *' : 'Сотрудник из зарплаты'}</label>
                {payrollLoading && payrollSelectItems.length === 0 ? (
                  <p className="form-hint">Загрузка списка…</p>
                ) : payrollSelectItems.length === 0 ? (
                  <p className="form-hint">
                    В зарплате филиала «{branchName}» пока нет сотрудников. Сначала нажмите «Импорт Excel» на вкладке «Зарплата / Face ID».
                  </p>
                ) : (
                  <CounterpartySearchSelect
                    items={payrollSelectItems}
                    value={userForm.payroll_employee_id || ''}
                    onChange={pickPayrollEmployee}
                    placeholder="Найти ФИО из списка зарплаты…"
                  />
                )}
              </div>
            )}
            <div className="form-group">
              <label>Имя *</label>
              <input
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                placeholder={!isProtectedForm ? 'Выберите из списка' : ''}
                readOnly={!isProtectedForm}
              />
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
                {Object.entries(availableRoles).map(([k, r]) => (
                  <option key={k} value={k}>{r.label}</option>
                ))}
              </select>
            </div>
            {userForm.role !== 'admin' && (
              <div className="form-group">
                <label>Филиал *</label>
                <select
                  value={userForm.branch_id || ''}
                  onChange={(e) => setUserForm({
                    ...userForm,
                    branch_id: e.target.value,
                    department_id: '',
                  })}
                >
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
            {userForm.role !== 'admin' && (
              <div className="form-group">
                <label>Отдел</label>
                <select
                  value={userForm.department_id || ''}
                  onChange={(e) => setUserForm({ ...userForm, department_id: e.target.value })}
                >
                  <option value="">Не назначен</option>
                  {formDepartments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <span className="form-hint">Для кладовщика отдела нужен отдел — тогда с телефона откроется перемещение.</span>
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
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <p className="form-hint">
                После сохранения у сотрудника появится уникальная ссылка. Её можно скопировать из списка и открыть на телефоне — вход без логина и пароля, сразу в раздел по роли.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
