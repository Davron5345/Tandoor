import { useEffect, useState } from 'react';
import Modal, { ModalCancelButton } from './Modal';
import { api, formatDate, formatDateTime, formatMoney, formatQty, ACTION_LABELS } from '../api';

/** Сервер пишет `created_at` в UTC без зоны (`YYYY-MM-DD HH:MM:SS`). */
function formatServerTime(value) {
  const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (!m) return formatDateTime(value);
  const date = new Date(`${m[1]}T${m[2]}Z`);
  if (Number.isNaN(date.getTime())) return formatDateTime(value);
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatValue(kind, value) {
  if (value == null || value === '') return '—';
  if (kind === 'money') return formatMoney(value);
  if (kind === 'qty') return formatQty(value);
  if (kind === 'date') return formatDate(value);
  if (kind === 'bool') return value ? 'да' : 'нет';
  return String(value);
}

function BeforeAfter({ kind, before, after }) {
  return (
    <span className="doc-history-ba">
      <span className="doc-history-before">{formatValue(kind, before)}</span>
      <span className="doc-history-arrow">→</span>
      <span className="doc-history-after">{formatValue(kind, after)}</span>
    </span>
  );
}

function RowValues({ values }) {
  if (!values?.length) return null;
  return (
    <span className="doc-history-values">
      {values.map((v) => `${v.label}: ${formatValue(v.kind, v.value)}`).join(' · ')}
    </span>
  );
}

function RowsDiff({ title, diff }) {
  if (!diff) return null;
  return (
    <div className="doc-history-section">
      <div className="doc-history-section-title">{title}</div>
      <ul className="doc-history-rows">
        {diff.added.map((r, idx) => (
          <li key={`a-${idx}`} className="is-added">
            <span className="doc-history-tag">+ добавлено</span>
            <strong>{r.name}</strong>
            <RowValues values={r.values} />
          </li>
        ))}
        {diff.removed.map((r, idx) => (
          <li key={`r-${idx}`} className="is-removed">
            <span className="doc-history-tag">− удалено</span>
            <strong>{r.name}</strong>
            <RowValues values={r.values} />
          </li>
        ))}
        {diff.changed.map((r, idx) => (
          <li key={`c-${idx}`} className="is-changed">
            <span className="doc-history-tag">изменено</span>
            <strong>{r.name}</strong>
            <span className="doc-history-row-fields">
              {r.fields.map((f) => (
                <span key={f.label} className="doc-history-row-field">
                  {f.label}: <BeforeAfter kind={f.kind} before={f.before} after={f.after} />
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryBody({ entry }) {
  if (!entry.details_available) {
    return <div className="doc-history-muted">Подробности для этой записи не сохранялись (старая запись).</div>;
  }
  const { changes } = entry;
  const hasRows = changes.items || changes.extra_costs || changes.lines;
  if (entry.is_initial) {
    return (
      <>
        {changes.fields.length > 0 && (
          <dl className="doc-history-initial">
            {changes.fields.map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{formatValue(f.kind, f.after)}</dd>
              </div>
            ))}
          </dl>
        )}
        <RowsDiff title="Позиции" diff={changes.items} />
        <RowsDiff title="Доп. расходы" diff={changes.extra_costs} />
        <RowsDiff title="Строки" diff={changes.lines} />
      </>
    );
  }
  if (!changes.fields.length && !hasRows) {
    return <div className="doc-history-muted">Содержимое не менялось.</div>;
  }
  return (
    <>
      {changes.fields.length > 0 && (
        <table className="doc-history-fields">
          <thead>
            <tr><th>Поле</th><th>Было</th><th>Стало</th></tr>
          </thead>
          <tbody>
            {changes.fields.map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td>
                <td className="doc-history-before">{formatValue(f.kind, f.before)}</td>
                <td className="doc-history-after">{formatValue(f.kind, f.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <RowsDiff title="Позиции" diff={changes.items} />
      <RowsDiff title="Доп. расходы" diff={changes.extra_costs} />
      <RowsDiff title="Строки" diff={changes.lines} />
    </>
  );
}

export default function DocumentHistoryModal({ documentId, title = 'История изменений', onClose }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError('');
    api.getDocumentHistory(documentId)
      .then((list) => { if (!cancelled) setEntries(Array.isArray(list) ? list : []); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Не удалось загрузить историю'); });
    return () => { cancelled = true; };
  }, [documentId]);

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      closeOnBackdrop
      className="doc-history-modal"
      footer={<ModalCancelButton>Закрыть</ModalCancelButton>}
    >
      {error && <div className="alert alert-error">{error}</div>}
      {!error && entries === null && <div className="empty">Загрузка…</div>}
      {entries?.length === 0 && <div className="empty">История пуста</div>}
      {entries?.length > 0 && (
        <ol className="doc-history-list">
          {entries.map((h) => (
            <li key={h.id} className={`doc-history-entry action-${h.action}`}>
              <div className="doc-history-head">
                <span className="doc-history-action">{ACTION_LABELS[h.action] || h.action}</span>
                <span className="doc-history-who">{h.user_name || h.changed_by_name || 'Не указан'}</span>
                <span className="doc-history-when">{formatServerTime(h.created_at)}</span>
              </div>
              <EntryBody entry={h} />
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
