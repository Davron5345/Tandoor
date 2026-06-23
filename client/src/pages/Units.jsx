import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Modal, { useToast } from '../components/Modal';
import { IconButton, IconArrowDown, IconArrowUp, IconEdit, IconPlus, IconTrash } from '../components/ActionIcons';
import { useAuth } from '../AuthContext';
import { hasPermission } from '../permissions';

const emptyForm = { name: '', sort_order: 0 };

export default function Units() {
  const [units, setUnits] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const canEdit = hasPermission(user, 'products.edit');

  const load = useCallback(() => {
    api.getUnits().then(setUnits).catch(console.error);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(
    () => [...units].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'ru')),
    [units],
  );

  const openCreate = () => {
    const maxSort = rows.reduce((m, u) => Math.max(m, u.sort_order || 0), 0);
    setForm({ name: '', sort_order: maxSort + 1 });
    setModal('create');
  };

  const openEdit = (unit) => {
    setForm({ name: unit.name, sort_order: unit.sort_order || 0 });
    setModal(unit.id);
  };

  const save = async () => {
    if (!form.name.trim()) {
      show('Укажите название единицы измерения', 'error');
      return;
    }
    try {
      const payload = {
        name: form.name.trim(),
        sort_order: Number(form.sort_order) || 0,
      };
      if (modal === 'create') {
        await api.createUnit(payload);
        show('Единица добавлена');
      } else {
        await api.updateUnit(modal, payload);
        show('Единица обновлена');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (unit) => {
    if (!window.confirm(`Удалить единицу «${unit.name}»?`)) return;
    try {
      await api.deleteUnit(unit.id);
      show('Единица удалена');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const moveUnit = async (unit, delta) => {
    const index = rows.findIndex((u) => u.id === unit.id);
    const swap = rows[index + delta];
    if (!swap) return;
    try {
      await Promise.all([
        api.updateUnit(unit.id, { sort_order: swap.sort_order }),
        api.updateUnit(swap.id, { sort_order: unit.sort_order }),
      ]);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  return (
    <div className="units-page">
      {Toast}

      <div className="page-header">
        <div>
          <h1>Единицы измерения</h1>
          <p className="page-subtitle-plain">
            Справочник единиц для номенклатуры.{' '}
            <Link to="/products">Номенклатура</Link>
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <IconPlus /> Добавить
          </button>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="cash-articles-table">
            <thead>
              <tr>
                <th className="col-order">№</th>
                <th>Название</th>
                <th className="col-usage">Использований</th>
                {canEdit && <th className="col-actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((unit, index) => (
                <tr key={unit.id}>
                  <td className="muted col-order">{unit.sort_order ?? index + 1}</td>
                  <td>{unit.name}</td>
                  <td className="muted col-usage">{unit.usage_count || 0}</td>
                  {canEdit && (
                    <td className="cash-articles-actions">
                      <div className="icon-toolbar">
                        <IconButton
                          className="btn-icon-move"
                          title="Выше"
                          disabled={index === 0}
                          onClick={() => moveUnit(unit, -1)}
                        >
                          <IconArrowUp />
                        </IconButton>
                        <IconButton
                          className="btn-icon-move"
                          title="Ниже"
                          disabled={index === rows.length - 1}
                          onClick={() => moveUnit(unit, 1)}
                        >
                          <IconArrowDown />
                        </IconButton>
                        <span className="icon-toolbar-sep" aria-hidden="true" />
                        <IconButton title="Изменить" onClick={() => openEdit(unit)}>
                          <IconEdit />
                        </IconButton>
                        <IconButton title="Удалить" danger onClick={() => remove(unit)}>
                          <IconTrash />
                        </IconButton>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={canEdit ? 4 : 3} className="empty">Единиц пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Новая единица' : 'Редактировать единицу'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group full">
              <label>Название *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Например: кг"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Порядок</label>
              <input
                type="number"
                min="0"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: +e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
