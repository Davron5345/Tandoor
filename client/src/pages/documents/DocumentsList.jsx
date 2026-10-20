import { formatMoney, formatDate, STATUS_LABELS } from '../../api';
import {
  IconButton,
  IconEye,
  IconMore,
  IconTransfer,
  IconWallet,
} from '../../components/ActionIcons';
import TelegramMessageLink from '../../components/TelegramMessageLink';
import { RETURN_SUPPLIER_TYPE, RETURN_CUSTOMER_TYPE } from './docUtils';

function DocRowActions({
  doc: d,
  isReadOnly,
  canTransfer,
  canPay,
  getDocRemaining,
  onOpen,
  onTransfer,
  onPay,
  onToggleMenu,
}) {
  return (
    <>
      <IconButton
        title={isReadOnly ? 'Просмотр' : 'Открыть'}
        onClick={() => onOpen(d.id, d.type)}
      >
        <IconEye />
      </IconButton>
      {canTransfer && d.status === 'confirmed' && d.type === 'prihod' && (
        <IconButton title="Перемещение" onClick={() => onTransfer(d)}>
          <IconTransfer />
        </IconButton>
      )}
      {canPay && d.status === 'confirmed'
        && (d.type === 'prihod' || d.type === 'rashod')
        && d.counterparty_id
        && getDocRemaining(d) > 0 && (
        <IconButton title="Оплатить" onClick={() => onPay(d)}>
          <IconWallet />
        </IconButton>
      )}
      <div className="doc-actions-more">
        <IconButton
          title="Ещё"
          onClick={(e) => onToggleMenu(d.id, e.currentTarget.closest('.doc-actions-more'))}
        >
          <IconMore />
        </IconButton>
      </div>
    </>
  );
}

export default function DocumentsList({
  docs,
  visibleDocs,
  isPhone,
  defaultType,
  typeLabel,
  docBranchLabel,
  docPage,
  docPages,
  docTotal,
  setDocPage,
  ...actionProps
}) {
  const { onOpen } = actionProps;
  return (
    <div className="card docs-list-card">
      {isPhone ? (
        <div className="docs-list-cards">
          {visibleDocs.map((d) => (
            <article
              key={d.id}
              className={`docs-doc-card${d.ai_recognized ? ' docs-doc-card--ai' : ''}`}
            >
              <button
                type="button"
                className="docs-doc-card-main"
                onClick={() => onOpen(d.id, d.type)}
              >
                <div className="docs-doc-card-top">
                  <strong>№{d.number}</strong>
                  <span className={`badge badge-${d.status}`}>{STATUS_LABELS[d.status]}</span>
                  {!!d.ai_recognized && (
                    <span className="badge badge-ai" title="Распознано искусственным интеллектом">ИИ</span>
                  )}
                  {!!d.ai_recognized && Number(d.ai_unconfirmed_count) > 0 && (
                    <span className="badge badge-ai-pending">
                      Неподтв. {d.ai_unconfirmed_count}
                    </span>
                  )}
                </div>
                <div className="docs-doc-card-meta">
                  <span className="docs-doc-card-meta-left">
                    {formatDate(d.date)}
                    {!defaultType ? ` · ${typeLabel(d.type)}` : ''}
                  </span>
                  <span className="docs-doc-card-sum">{formatMoney(d.total_amount)}</span>
                </div>
                <div className="docs-doc-card-party">
                  {d.counterparty_name || docBranchLabel(d) || '—'}
                </div>
              </button>
              <div className="docs-doc-card-actions">
                {d.telegram_url && (
                  <TelegramMessageLink url={d.telegram_url} className="tg-message-link--sm" />
                )}
                <DocRowActions doc={d} {...actionProps} />
              </div>
            </article>
          ))}
          {docs.length === 0 && (
            <div className="empty docs-list-empty">Нет документов</div>
          )}
        </div>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Тип</th>
              <th>Контрагент</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {visibleDocs.map((d) => (
              <tr key={d.id} className={d.ai_recognized ? 'docs-row-ai' : undefined}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {d.number}
                    {d.telegram_url && (
                      <TelegramMessageLink url={d.telegram_url} className="tg-message-link--sm" />
                    )}
                  </span>
                </td>
                <td>{formatDate(d.date)}</td>
                <td>
                  <span className={`badge badge-${d.type === 'peremeshchenie' ? 'supplier' : ((d.type === RETURN_SUPPLIER_TYPE || d.type === RETURN_CUSTOMER_TYPE) ? 'rashod' : d.type)}`}>
                    {typeLabel(d.type)}
                  </span>
                  {!!d.ai_recognized && (
                    <span className="badge badge-ai" style={{ marginLeft: 6 }} title="Распознано ИИ">ИИ</span>
                  )}
                </td>
                <td>{d.counterparty_name || docBranchLabel(d) || '—'}</td>
                <td>{formatMoney(d.total_amount)}</td>
                <td>
                  <span className={`badge badge-${d.status}`}>{STATUS_LABELS[d.status]}</span>
                  {!!d.ai_recognized && Number(d.ai_unconfirmed_count) > 0 && (
                    <span className="badge badge-ai-pending" style={{ marginLeft: 6 }}>
                      Неподтв. {d.ai_unconfirmed_count}
                    </span>
                  )}
                </td>
                <td>
                  <div className="btn-group btn-group-icons doc-actions">
                    <DocRowActions doc={d} {...actionProps} />
                  </div>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr><td colSpan={7} className="empty">Нет документов</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {docPages > 1 && (
        <div className="table-pagination" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px', justifyContent: 'flex-end' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {docTotal} документов · стр. {docPage} из {docPages}
          </span>
          <button type="button" className="btn btn-ghost" disabled={docPage <= 1} onClick={() => setDocPage((p) => p - 1)}>
            ← Назад
          </button>
          <button type="button" className="btn btn-ghost" disabled={docPage >= docPages} onClick={() => setDocPage((p) => p + 1)}>
            Вперёд →
          </button>
        </div>
      )}
    </div>
  );
}
