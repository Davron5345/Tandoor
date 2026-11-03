import { useMemo, useState } from 'react';
import Modal, { ModalCancelButton } from './Modal';
import CounterpartySearchSelect from './CounterpartySearchSelect';

/**
 * Выбор целевого контрагента для объединения / переноса фирмы.
 */
export default function MergeCounterpartyModal({
  title = 'Присоединить к…',
  hint = 'Фирма(ы) перейдут к выбранному контрагенту. Документы и оплаты перепривяжутся.',
  sourceId,
  sourceName,
  sourceType,
  counterparties = [],
  busy = false,
  onClose,
  onConfirm,
}) {
  const [targetId, setTargetId] = useState('');

  const options = useMemo(
    () => counterparties.filter((c) => c.id !== sourceId && c.type === sourceType),
    [counterparties, sourceId, sourceType],
  );

  const target = options.find((c) => c.id === targetId);

  const submit = () => {
    if (!targetId || busy) return;
    const ok = window.confirm(
      `Присоединить «${sourceName}» к «${target?.name || targetId}»?\n`
      + 'Документы и оплаты будут перепривязаны. Пустая карточка удалится.',
    );
    if (!ok) return;
    onConfirm(targetId);
  };

  return (
    <Modal
      title={title}
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <ModalCancelButton disabled={busy} />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !targetId}
            onClick={submit}
          >
            {busy ? 'Объединение…' : 'Присоединить'}
          </button>
        </>
      )}
    >
      <p className="text-muted" style={{ marginTop: 0 }}>{hint}</p>
      <div className="form-group">
        <label>Куда присоединить</label>
        <CounterpartySearchSelect
          items={options}
          value={targetId}
          onChange={setTargetId}
          disabled={busy}
          placeholder={sourceType === 'client' ? 'Найти клиента…' : 'Найти поставщика…'}
        />
      </div>
      {options.length === 0 && (
        <p className="muted">Нет других контрагентов того же типа в этом филиале.</p>
      )}
    </Modal>
  );
}
