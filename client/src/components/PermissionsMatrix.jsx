import { Fragment } from 'react';

const DEFAULT_ACTION_ORDER = ['view', 'write', 'confirm', 'delete', 'editPast'];

function groupByCategory(groups, categories) {
  const map = new Map(categories.map((c) => [c.id, { ...c, groups: [] }]));
  for (const group of groups) {
    const bucket = map.get(group.category);
    if (bucket) bucket.groups.push(group);
  }
  return categories.map((c) => map.get(c.id)).filter((c) => c?.groups.length);
}

function rowCheckedCount(group, matrix, actions) {
  return actions.filter((action) => matrix[group.id]?.[action]).length;
}

export default function PermissionsMatrix({
  permConfig,
  matrix,
  actionLabels,
  actionTooltips = {},
  presets = [],
  onToggle,
  onToggleRow,
  onToggleColumn,
  onToggleCategory,
  onApplyPreset,
}) {
  const actionOrder = permConfig.actionOrder || DEFAULT_ACTION_ORDER;
  const visibleActions = actionOrder.filter((action) => actionLabels[action]);
  const sections = groupByCategory(permConfig.groups, permConfig.categories || []);

  return (
    <div className="perm-matrix-wrap">
      {presets.length > 0 && onApplyPreset && (
        <div className="perm-presets">
          <span className="perm-presets-label">Быстрые наборы:</span>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="perm-preset-btn"
              title={preset.description}
              onClick={() => onApplyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <div className="perm-matrix-hint-box">
        <strong>Касса для кассира:</strong>
        {' '}
        «Касса → Смотреть + Редактировать + Удалить», «Контрагенты → Смотреть» (для закупа).
        Прошлые даты — только бухгалтеру. После сохранения сотруднику нужен повторный вход.
      </div>

      <div className="table-wrap perm-matrix-scroll">
        <table className="perm-matrix">
          <thead>
            <tr>
              <th className="perm-col-section">Раздел</th>
              {visibleActions.map((action) => (
                <th key={action} className="perm-col-action">
                  <span title={actionTooltips[action] || ''}>{actionLabels[action]}</span>
                  {onToggleColumn && (
                    <button
                      type="button"
                      className="perm-bulk-btn"
                      title={`Включить/выключить «${actionLabels[action]}» для всех разделов`}
                      onClick={() => onToggleColumn(action)}
                    >
                      все
                    </button>
                  )}
                </th>
              ))}
              {onToggleRow && <th className="perm-col-row">Строка</th>}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.id}>
                <tr className="perm-category-row">
                  <td colSpan={visibleActions.length + (onToggleRow ? 2 : 1)}>
                    <div className="perm-category-head">
                      <span>{section.label}</span>
                      {onToggleCategory && (
                        <span className="perm-category-actions">
                          <button
                            type="button"
                            className="perm-bulk-btn"
                            onClick={() => onToggleCategory(section.id, true)}
                          >
                            Включить раздел
                          </button>
                          <button
                            type="button"
                            className="perm-bulk-btn"
                            onClick={() => onToggleCategory(section.id, false)}
                          >
                            Снять
                          </button>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
                {section.groups.map((group) => {
                  const checked = rowCheckedCount(group, matrix, group.actions);
                  const total = group.actions.length;
                  const allChecked = checked === total;
                  return (
                    <tr key={group.id} className={checked ? 'perm-row-active' : ''}>
                      <td className="perm-section-cell">
                        <span className="perm-section-label">
                          <span className="perm-section-icon" aria-hidden="true">{group.icon || '•'}</span>
                          <span>
                            <strong>{group.label}</strong>
                            {group.hint && (
                              <span className="perm-section-hint">{group.hint}</span>
                            )}
                            <span className="perm-section-meta">{checked}/{total}</span>
                          </span>
                        </span>
                      </td>
                      {visibleActions.map((action) => {
                        if (!group.actions.includes(action)) {
                          return <td key={action} className="perm-empty">—</td>;
                        }
                        const isChecked = !!matrix[group.id]?.[action];
                        return (
                          <td key={action} className="perm-check">
                            <label
                              className={`perm-option${isChecked ? ' is-checked' : ''}`}
                              title={actionTooltips[action] || actionLabels[action]}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => onToggle(group.id, action)}
                              />
                            </label>
                          </td>
                        );
                      })}
                      {onToggleRow && (
                        <td className="perm-row-toggle">
                          <button
                            type="button"
                            className="perm-bulk-btn"
                            onClick={() => onToggleRow(group.id, !allChecked)}
                          >
                            {allChecked ? 'снять' : 'все'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
