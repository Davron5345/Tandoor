import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import Modal, { useToast } from '../components/Modal';
import PermissionsMatrix from '../components/PermissionsMatrix';
import { slugFromLabel } from '../utils/roleSlug';
import { useBranch } from '../BranchContext';

const emptyRole = { id: '', label: '', description: '', copyFrom: '' };

export default function Roles() {
  const { branchId, isHeadquarters, branchName } = useBranch();
  const [rolesList, setRolesList] = useState([]);
  const [permConfig, setPermConfig] = useState(null);
  const [matrix, setMatrix] = useState({});
  const [savingPerms, setSavingPerms] = useState(false);
  const [roleModal, setRoleModal] = useState(null);
  const [roleForm, setRoleForm] = useState(emptyRole);
  const [permsModal, setPermsModal] = useState(null);
  const [idManual, setIdManual] = useState(false);
  const { show, Toast } = useToast();

  const editableRoles = useMemo(
    () => rolesList.filter((r) => r.id !== 'admin'),
    [rolesList],
  );

  const load = () => {
    Promise.all([api.getRolesList(), api.getPermissionsConfig()])
      .then(([list, cfg]) => {
        setRolesList(list);
        setPermConfig(cfg);
      })
      .catch(console.error);
  };

  const loadRoleMatrix = (role) => {
    if (!role || role === 'admin') return Promise.resolve();
    return api.getRolePermissions(role)
      .then((data) => setMatrix(data.matrix))
      .catch(console.error);
  };

  useEffect(() => { load(); }, [branchId]);

  const openCreateRole = () => {
    setRoleForm({ ...emptyRole, copyFrom: editableRoles[0]?.id || 'cashier' });
    setIdManual(false);
    setRoleModal('create');
  };

  const openRolePermissions = (roleId, mode) => {
    const meta = rolesList.find((r) => r.id === roleId);
    if (!meta) return;
    if (mode === 'edit') {
      setRoleForm({
        id: roleId,
        label: meta.label,
        description: meta.description || '',
        copyFrom: '',
      });
    }
    setPermsModal({ roleId, mode });
    loadRoleMatrix(roleId);
  };

  const closePermsModal = () => {
    setPermsModal(null);
    setMatrix({});
  };

  const onRoleLabelChange = (label) => {
    setRoleForm((prev) => ({
      ...prev,
      label,
      id: !idManual ? slugFromLabel(label) : prev.id,
    }));
  };

  const saveRole = async () => {
    try {
      const payload = {
        label: roleForm.label,
        description: roleForm.description,
        copyFrom: roleForm.copyFrom || undefined,
      };
      if (roleForm.id.trim()) payload.id = roleForm.id.trim();
      const created = await api.createRole(payload);
      show('Роль добавлена');
      setRoleModal(null);
      load();
      openRolePermissions(created.id, 'permissions');
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const savePermsModal = async () => {
    if (!permsModal) return;
    setSavingPerms(true);
    try {
      if (permsModal.mode === 'edit') {
        await api.updateRole(permsModal.roleId, {
          label: roleForm.label,
          description: roleForm.description,
        });
      }
      await api.saveRolePermissions(permsModal.roleId, matrix);
      show('Сохранено. Сотрудникам с этой ролью нужно перезайти.');
      closePermsModal();
      load();
    } catch (e) {
      show(e.message, 'error');
    } finally {
      setSavingPerms(false);
    }
  };

  const removeRole = async (roleId) => {
    const meta = rolesList.find((r) => r.id === roleId);
    if (!meta || meta.protected) return;
    if (!window.confirm(`Удалить роль «${meta.label}»?`)) return;
    try {
      await api.deleteRole(roleId);
      show('Роль удалена');
      if (permsModal?.roleId === roleId) closePermsModal();
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const togglePerm = (groupId, action) => {
    setMatrix((prev) => {
      const next = {
        ...prev,
        [groupId]: {
          ...prev[groupId],
          [action]: !prev[groupId]?.[action],
        },
      };
      const enabled = next[groupId][action];
      if (enabled) {
        if (groupId === 'cashier' && ['write', 'delete', 'editPast'].includes(action)) {
          next.cashier = { ...next.cashier, view: true };
        }
        if (groupId === 'cashier' && action === 'editPast') {
          next.cashier = { ...next.cashier, write: true, view: true };
        }
        if (groupId === 'cashier' && ['write', 'delete'].includes(action)) {
          next.counterparties = { ...next.counterparties, view: true };
        }
        if (groupId === 'payments' && ['write', 'delete', 'editPast'].includes(action)) {
          next.payments = { ...next.payments, view: true };
        }
      }
      return next;
    });
  };

  const applyPreset = (presetId) => {
    const preset = permConfig?.presets?.find((p) => p.id === presetId);
    if (!preset) return;
    setMatrix((prev) => {
      const next = { ...prev };
      for (const [groupId, actions] of Object.entries(preset.groups)) {
        next[groupId] = { ...(next[groupId] || {}) };
        for (const [action, value] of Object.entries(actions)) {
          next[groupId][action] = value;
        }
      }
      return next;
    });
    show(`Набор «${preset.label}» применён — проверьте и сохраните`);
  };

  const togglePermRow = (groupId, value) => {
    const group = permConfig?.groups.find((g) => g.id === groupId);
    if (!group) return;
    setMatrix((prev) => {
      const next = { ...prev, [groupId]: { ...prev[groupId] } };
      for (const action of group.actions) next[groupId][action] = value;
      return next;
    });
  };

  const togglePermColumn = (action) => {
    if (!permConfig) return;
    const groups = permConfig.groups.filter((g) => g.actions.includes(action));
    const allOn = groups.every((g) => matrix[g.id]?.[action]);
    setMatrix((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        next[group.id] = { ...next[group.id], [action]: !allOn };
      }
      return next;
    });
  };

  const togglePermCategory = (categoryId, value) => {
    if (!permConfig) return;
    const groups = permConfig.groups.filter((g) => g.category === categoryId);
    setMatrix((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        next[group.id] = { ...next[group.id] };
        for (const action of group.actions) next[group.id][action] = value;
      }
      return next;
    });
  };

  const actionLabels = permConfig?.actionLabels || {};
  const actionTooltips = permConfig?.actionTooltips || {};
  const permsRoleMeta = permsModal ? rolesList.find((r) => r.id === permsModal.roleId) : null;

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Роли</h1>
        <button type="button" className="btn btn-primary" onClick={openCreateRole}>+ Добавить роль</button>
      </div>

      <div className="card">
        <div className="card-header">
          <strong>Список ролей</strong>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {isHeadquarters
              ? 'Головной офис Asosiy: все роли всех филиалов'
              : `Роли филиала «${branchName}»`}
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Код</th>
                {isHeadquarters && <th>Филиал</th>}
                <th>Сотрудников</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rolesList.map((role) => (
                <tr key={role.id}>
                  <td>
                    <strong>{role.label}</strong>
                    {role.protected && <span title="Полный доступ"> ★</span>}
                    {role.description && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{role.description}</div>
                    )}
                  </td>
                  <td><code>{role.id}</code></td>
                  {isHeadquarters && <td>{role.branchName || '—'}</td>}
                  <td>{role.userCount}</td>
                  <td>
                    <div className="btn-group">
                      {role.id !== 'admin' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => openRolePermissions(role.id, 'permissions')}
                          >
                            Права
                          </button>
                          {!role.protected && (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={() => openRolePermissions(role.id, 'edit')}
                              >
                                Изменить
                              </button>
                              <button type="button" className="btn btn-sm btn-danger" onClick={() => removeRole(role.id)}>Удалить</button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {roleModal === 'create' && (
        <Modal
          title="Новая роль"
          onClose={() => setRoleModal(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRoleModal(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={saveRole}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Название *</label>
              <input
                value={roleForm.label}
                onChange={(e) => onRoleLabelChange(e.target.value)}
                placeholder="Кассир 1, Бухгалтер, Директор..."
              />
            </div>
            <div className="form-group">
              <label>Код роли</label>
              <input
                value={roleForm.id}
                onChange={(e) => {
                  setIdManual(true);
                  setRoleForm({ ...roleForm, id: e.target.value });
                }}
                placeholder="kassir1"
              />
              <small style={{ color: 'var(--text-muted)' }}>Создаётся автоматически из названия, можно изменить</small>
            </div>
            <div className="form-group full-width">
              <label>Скопировать права с роли</label>
              <select
                value={roleForm.copyFrom}
                onChange={(e) => setRoleForm({ ...roleForm, copyFrom: e.target.value })}
              >
                <option value="">Без прав (настроите вручную)</option>
                {rolesList.filter((r) => r.id !== 'admin').map((role) => (
                  <option key={role.id} value={role.id}>{role.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group full-width">
              <label>Описание</label>
              <input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}

      {permsModal && permConfig && (
        <Modal
          wide
          className="modal-perms"
          title={
            permsModal.mode === 'edit'
              ? `Изменить роль: ${permsRoleMeta?.label || ''}`
              : `Права роли: ${permsRoleMeta?.label || ''}`
          }
          onClose={closePermsModal}
          footer={
            <>
              <button className="btn btn-ghost" onClick={closePermsModal}>Отмена</button>
              <button className="btn btn-primary" onClick={savePermsModal} disabled={savingPerms}>
                {savingPerms ? 'Сохранение...' : 'Сохранить'}
              </button>
            </>
          }
        >
          {permsModal.mode === 'edit' && (
            <div className="form-grid" style={{ marginBottom: 20 }}>
              <div className="form-group">
                <label>Название *</label>
                <input
                  value={roleForm.label}
                  onChange={(e) => setRoleForm({ ...roleForm, label: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Описание</label>
                <input
                  value={roleForm.description}
                  onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                />
              </div>
            </div>
          )}

          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 13 }}>
            Код: <code>{permsModal.roleId}</code>
          </p>

          <PermissionsMatrix
            permConfig={permConfig}
            matrix={matrix}
            actionLabels={actionLabels}
            actionTooltips={actionTooltips}
            presets={permConfig.presets || []}
            onToggle={togglePerm}
            onToggleRow={togglePermRow}
            onToggleColumn={togglePermColumn}
            onToggleCategory={togglePermCategory}
            onApplyPreset={applyPreset}
          />
        </Modal>
      )}
    </div>
  );
}
