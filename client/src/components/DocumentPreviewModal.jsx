import { useEffect, useState } from 'react';
import Modal, { ModalCancelButton } from './Modal';
import { api, formatDate, formatMoney, formatQty, STATUS_LABELS } from '../api';
import { DOC_TYPE_LABELS } from '../permissions';

function itemName(item) {
  const base = item.product_name || '—';
  return item.variant_name ? `${base} — ${item.variant_name}` : base;
}

function departmentLabel(doc) {
  if (doc.from_department_name && doc.to_department_name) {
    return `${doc.from_department_name} → ${doc.to_department_name}`;
  }
  return doc.to_department_name || doc.from_department_name || '';
}

export default function DocumentPreviewModal({ documentId, onClose }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError('');
    api.getDocument(documentId)
      .then((data) => { if (!cancelled) setDoc(data); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Не удалось загрузить документ'); });
    return () => { cancelled = true; };
  }, [documentId]);

  const typeLabel = doc ? (DOC_TYPE_LABELS[doc.type] || doc.type) : 'Документ';
  const title = doc ? `${typeLabel} №${doc.number}` : 'Документ';
  const items = doc
    ? (doc.items || []).filter((i) => !i.item_role || i.item_role === 'input' || i.item_role === 'output')
    : [];
  const hasNet = items.some((i) => Number(i.net_weight) > 0);
  const extras = doc?.extra_costs || [];
  const department = doc ? departmentLabel(doc) : '';

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      closeOnBackdrop
      className="doc-preview-modal"
      footer={<ModalCancelButton>Закрыть</ModalCancelButton>}
    >
      {error && <div className="alert alert-error">{error}</div>}
      {!error && !doc && <div className="empty">Загрузка…</div>}
      {doc && (
        <div className="doc-preview">
          <div className="doc-preview-readonly-note">Только просмотр — редактирование недоступно</div>
          <dl className="doc-preview-meta">
            <div><dt>Дата</dt><dd>{formatDate(doc.date)}</dd></div>
            <div>
              <dt>Статус</dt>
              <dd><span className={`badge badge-${doc.status}`}>{STATUS_LABELS[doc.status] || doc.status}</span></dd>
            </div>
            {doc.counterparty_name && (
              <div><dt>Контрагент</dt><dd>{doc.counterparty_name}</dd></div>
            )}
            {doc.firm_name && (
              <div><dt>Фирма</dt><dd>{doc.firm_name}{doc.firm_inn ? ` (ИНН ${doc.firm_inn})` : ''}</dd></div>
            )}
            {doc.counterparty_id && doc.contract_number && (
              <div>
                <dt>Договор</dt>
                <dd>{doc.contract_number}{doc.contract_date ? ` от ${formatDate(doc.contract_date)}` : ''}</dd>
              </div>
            )}
            {department && <div><dt>Отдел</dt><dd>{department}</dd></div>}
            {doc.branch_name && <div><dt>Филиал</dt><dd>{doc.branch_name}</dd></div>}
            {doc.comment && <div className="doc-preview-meta-wide"><dt>Комментарий</dt><dd>{doc.comment}</dd></div>}
          </dl>

          <div className="table-wrap doc-preview-table">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Товар</th>
                  <th>Ед.</th>
                  <th className="num">Кол-во</th>
                  {hasNet && <th className="num">Нетто</th>}
                  <th className="num">Цена</th>
                  <th className="num">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td>{idx + 1}</td>
                    <td>{itemName(item)}</td>
                    <td>{item.unit || ''}</td>
                    <td className="num">{formatQty(item.quantity)}</td>
                    {hasNet && <td className="num">{Number(item.net_weight) > 0 ? formatQty(item.net_weight) : ''}</td>}
                    <td className="num">{formatMoney(item.price)}</td>
                    <td className="num">{formatMoney(item.amount)}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={hasNet ? 7 : 6} className="empty">Нет позиций</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {extras.length > 0 && (
            <div className="doc-preview-extras">
              <div className="doc-preview-subtitle">Доп. расходы</div>
              <ul>
                {extras.map((e, idx) => (
                  <li key={e.id || idx}>
                    <span>{e.title}{e.capitalize ? ' (в себестоимость)' : ' (в расходы)'}</span>
                    <span>{formatMoney(e.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="doc-preview-totals">
            <div><span>Итого</span><strong>{formatMoney(doc.total_amount)}</strong></div>
            {extras.length > 0 && (
              <div><span>С доп. расходами в себестоимости</span><strong>{formatMoney(doc.landed_total)}</strong></div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
