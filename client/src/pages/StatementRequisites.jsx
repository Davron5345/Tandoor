import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Modal, { useToast, ModalCancelButton } from '../components/Modal';
import BranchChip from '../components/BranchChip';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { hasPermission } from '../permissions';

function typeLabel(type) {
  return type === 'client' ? 'Клиент' : 'Поставщик';
}

function formatAccounts(accounts) {
  if (!accounts?.length) return '—';
  return accounts.join(', ');
}

function formatContracts(contracts) {
  if (!contracts?.length) return '—';
  return contracts
    .map((c) => (c.date ? `№${c.number} от ${c.date}` : `№${c.number}`))
    .join('; ');
}

export default function StatementRequisites() {
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchName } = useBranch();
  const canEdit = hasPermission(user, 'counterparties.edit');
  const fileRef = useRef(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [meta, setMeta] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('new');
  const [result, setResult] = useState(null);

  const selectedCount = useMemo(
    () => items.filter((i) => i.selected !== false).length,
    [items],
  );

  const visible = useMemo(() => {
    if (filter === 'new') return items.filter((i) => !i.in_directory);
    if (filter === 'known') return items.filter((i) => i.in_directory);
    if (filter === 'selected') return items.filter((i) => i.selected !== false);
    return items;
  }, [items, filter]);

  const openCreate = () => {
    setPasteText('');
    setCreateOpen(true);
  };

  const closeCreate = () => {
    if (busy) return;
    setCreateOpen(false);
  };

  const applyPreview = (preview) => {
    setMeta(preview);
    setItems((preview.items || []).map((row) => ({ ...row })));
    setFilter('new');
    setResult(null);
    setCreateOpen(false);
    setPasteText('');
    show(
      `Найдено контрагентов: ${preview.total}`
        + (preview.new_count ? `, новых: ${preview.new_count}` : ''),
    );
  };

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      applyPreview(await api.parseStatementRequisites(file));
    } catch (err) {
      show(err.message || 'Не удалось разобрать выписку', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onParsePaste = async () => {
    if (!pasteText.trim()) {
      show('Вставьте текст выписки из Client Bank', 'error');
      return;
    }
    setBusy(true);
    try {
      applyPreview(await api.parseStatementRequisitesText(pasteText));
    } catch (err) {
      show(err.message || 'Не удалось разобрать текст', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setSelected = (key, value) => {
    setItems((prev) => prev.map((row) => (row.key === key ? { ...row, selected: value } : row)));
  };

  const setType = (key, type) => {
    setItems((prev) => prev.map((row) => (row.key === key ? { ...row, type } : row)));
  };

  const selectAllVisible = (value) => {
    const keys = new Set(visible.map((v) => v.key));
    setItems((prev) => prev.map((row) => (keys.has(row.key) ? { ...row, selected: value } : row)));
  };

  const selectOnlyNew = () => {
    setItems((prev) => prev.map((row) => ({ ...row, selected: !row.in_directory })));
  };

  const onApply = async () => {
    if (!canEdit) return;
    const chosen = items.filter((i) => i.selected !== false);
    if (!chosen.length) {
      show('Отметьте хотя бы одного контрагента', 'error');
      return;
    }
    setApplyBusy(true);
    try {
      const res = await api.applyStatementRequisites(chosen);
      setResult(res);
      show(
        `В справочник: создано ${res.created_count}, дополнено ${res.updated_count}`
          + (res.skipped_count ? `, пропущено ${res.skipped_count}` : ''),
      );
      const createdKeys = new Set((res.created || []).map((c) => c.key));
      setItems((prev) => prev.map((row) => (
        createdKeys.has(row.key)
          ? { ...row, selected: false, in_directory: true, match_reason: 'добавлен в справочник' }
          : row
      )));
    } catch (err) {
      show(err.message || 'Не удалось сохранить', 'error');
    } finally {
      setApplyBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Реквизиты из выписки</h1>
          <p className="page-subtitle">
            Текст Client Bank или Excel — названия, ИНН, р/с и договоры без сумм. Можно одну операцию или несколько лет.
            {' '}
            <BranchChip>{branchName}</BranchChip>
          </p>
        </div>
        <div className="page-header-actions">
          <Link to="/counterparties" className="btn btn-secondary">К контрагентам</Link>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            + Создать
          </button>
        </div>
      </div>

      {!meta && (
        <div className="card" style={{ padding: 24 }}>
          <p style={{ margin: 0, maxWidth: 640, lineHeight: 1.5 }}>
            Нажмите «+ Создать», вставьте выписку из Client Bank (или загрузите Excel).
            Система соберёт уникальных контрагентов по ИНН и названию, все р/с и договоры из назначения.
          </p>
        </div>
      )}

      {meta && (
        <>
          <div className="filters" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="muted">
              Операций: {meta.total_ops}
              {meta.own_account ? ` · наш счёт ${meta.own_account}` : ''}
              {' · '}контрагентов {meta.total}
              {' · '}новых {meta.new_count}
            </span>
            <label className="filter-field">
              <span className="filter-field-caption">Показать</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="new">Только новые</option>
                <option value="known">Уже в справочнике</option>
                <option value="selected">Отмеченные</option>
                <option value="all">Все</option>
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={selectOnlyNew}>
              Отметить новых
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => selectAllVisible(true)}>
              Отметить видимых
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => selectAllVisible(false)}>
              Снять видимых
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={applyBusy || selectedCount === 0}
                onClick={onApply}
              >
                {applyBusy ? 'Сохранение…' : `В справочник (${selectedCount})`}
              </button>
            )}
          </div>

          {result && (
            <div className="card" style={{ padding: '12px 16px', marginBottom: 12 }}>
              Создано карточек: {result.created_count}.
              Дополнено (фирмы/р/с/договоры): {result.updated_count}.
              Пропущено: {result.skipped_count}.
            </div>
          )}

          <div className="card table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Название</th>
                  <th>ИНН</th>
                  <th>Тип</th>
                  <th>Р/с</th>
                  <th>Договоры</th>
                  <th>В справочнике</th>
                  <th>Операций</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                      Нет строк в этом фильтре
                    </td>
                  </tr>
                )}
                {visible.map((row) => (
                  <tr key={row.key} style={row.in_directory ? undefined : { background: 'var(--ones-surface-warn, #fff8e1)' }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={row.selected !== false}
                        onChange={(e) => setSelected(row.key, e.target.checked)}
                        disabled={!canEdit}
                      />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.name}</div>
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{row.inn || '—'}</td>
                    <td>
                      <select
                        value={row.type}
                        onChange={(e) => setType(row.key, e.target.value)}
                        disabled={!canEdit}
                        style={{ minWidth: 110 }}
                      >
                        <option value="supplier">{typeLabel('supplier')}</option>
                        <option value="client">{typeLabel('client')}</option>
                      </select>
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 220, wordBreak: 'break-all' }}>
                      {formatAccounts(row.accounts)}
                      {row.new_accounts?.length > 0 && row.in_directory && (
                        <div className="muted" style={{ marginTop: 4 }}>
                          новые: {row.new_accounts.join(', ')}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 260 }}>{formatContracts(row.contracts)}</td>
                    <td style={{ fontSize: 13 }}>
                      {row.in_directory ? (
                        <span title={row.match_reason}>{row.match_reason || 'есть'}</span>
                      ) : (
                        <span className="badge">новый</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{row.mentions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {createOpen && (
        <Modal
          title="Выписка → реквизиты"
          wide
          dirty={Boolean(pasteText.trim())}
          onClose={closeCreate}
          footer={(
            <>
              <ModalCancelButton disabled={busy} />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Excel (.xlsx)
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !pasteText.trim()}
                onClick={onParsePaste}
              >
                {busy ? 'Разбор…' : 'Разобрать'}
              </button>
            </>
          )}
        >
          <label className="filter-field" style={{ display: 'block', width: '100%' }}>
            <span className="filter-field-caption">
              Вставьте текст из Client Bank — хоть одну строку, хоть несколько лет
            </span>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={16}
              autoFocus
              placeholder={'Дата | Счет | N док-та | VO | МФО | Дебет | Кредит | Назначение | ИНН\n05.01.26|20208…|…'}
              style={{
                width: '100%',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.35,
                resize: 'vertical',
                marginTop: 6,
                minHeight: 280,
              }}
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={onPick}
          />
          <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 13 }}>
            Эквайринг (Click/Payme/…) и наш счёт в список не попадают. Суммы не сохраняются.
          </p>
        </Modal>
      )}
      {Toast}
    </div>
  );
}
