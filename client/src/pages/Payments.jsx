import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatMoney, formatDate } from '../api';
import { PAYMENT_TYPES } from '../permissions';
import Modal, { useToast } from '../components/Modal';
import { hasPermission } from '../permissions';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

const empty = {
  type: 'supplier_payment',
  counterparty_id: '',
  document_id: '',
  amount: 0,
  date: new Date().toISOString().slice(0, 10),
  comment: '',
};

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(empty);
  const [importRows, setImportRows] = useState([]);
  const [importMeta, setImportMeta] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importFilter, setImportFilter] = useState('all');
  const fileRef = useRef(null);
  const { show, Toast } = useToast();
  const { user } = useAuth();
  const { branchName, branchId } = useBranch();
  const canEdit = hasPermission(user, 'payments.edit');
  const canDelete = hasPermission(user, 'payments.delete');

  const load = useCallback(async () => {
    try {
      const p = await api.getPayments();
      setPayments(p);
      setCounterparties([]);
      setDocuments([]);
    } catch (err) {
      console.error(err);
      show(err.message || 'Не удалось загрузить оплаты', 'error');
      return;
    }

    try {
      const [c, d] = await Promise.all([api.getCounterparties(), api.getDocuments()]);
      setCounterparties(c);
      setDocuments(d.filter((x) => x.status === 'confirmed'));
    } catch (err) {
      console.error(err);
    }
  }, [show]);

  useEffect(() => { load(); }, [load, branchId]);
  useAutoRefresh(load, [load, branchId], { enabled: !modal });

  const openCreate = () => { setForm({ ...empty }); setModal('create'); };
  const openEdit = (p) => {
    setForm({
      type: p.type,
      counterparty_id: p.counterparty_id || '',
      document_id: p.document_id || '',
      amount: p.amount,
      date: p.date,
      comment: p.comment || '',
    });
    setModal(p.id);
  };

  const save = async () => {
    try {
      if (modal === 'create') {
        await api.createPayment(form);
        show('Оплата добавлена');
      } else {
        await api.updatePayment(modal, form);
        show('Оплата обновлена');
      }
      setModal(null);
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Удалить оплату №${p.number}?`)) return;
    try {
      await api.deletePayment(p.id);
      show('Удалено');
      load();
    } catch (e) {
      show(e.message, 'error');
    }
  };

  const onPickStatement = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportBusy(true);
    try {
      const preview = await api.parseBankStatement(file);
      setImportRows((preview.rows || []).map((r) => ({ ...r })));
      setImportMeta(preview);
      setImportFilter('all');
      setModal('import');
      if (!preview.retail_client) {
        show('Создайте клиента «КЛИЕНТ» и договоры Click / Payme / Терминал — для эквайринга', 'error');
      }
    } catch (err) {
      show(err.message || 'Не удалось разобрать выписку', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const visibleImportRows = useMemo(() => {
    if (importFilter === 'selected') return importRows.filter((r) => r.selected);
    if (importFilter === 'debit') return importRows.filter((r) => r.direction === 'debit');
    if (importFilter === 'credit') return importRows.filter((r) => r.direction === 'credit');
    if (importFilter === 'unmatched') {
      return importRows.filter((r) => !r.counterparty_id && !r.already_imported);
    }
    return importRows;
  }, [importRows, importFilter]);

  const selectedImportCount = importRows.filter((r) => r.selected && !r.already_imported).length;

  const updateImportRow = (externalRef, patch) => {
    setImportRows((rows) => rows.map((r) => (
      r.external_ref === externalRef ? { ...r, ...patch } : r
    )));
  };

  const toggleAllVisible = (checked) => {
    const ids = new Set(visibleImportRows.map((r) => r.external_ref));
    setImportRows((rows) => rows.map((r) => (
      ids.has(r.external_ref) && !r.already_imported
        ? { ...r, selected: checked }
        : r
    )));
  };

  const confirmImport = async () => {
    const rows = importRows.filter((r) => r.selected && !r.already_imported);
    if (!rows.length) {
      show('Отметьте хотя бы одну строку', 'error');
      return;
    }
    setImportBusy(true);
    try {
      const result = await api.confirmBankStatement(rows);
      show(`Создано операций: ${result.created_count}`
        + (result.skipped_count ? `, пропущено: ${result.skipped_count}` : ''));
      setModal(null);
      setImportRows([]);
      setImportMeta(null);
      load();
    } catch (err) {
      show(err.message || 'Ошибка импорта', 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const filteredCp = counterparties.filter((c) => {
    if (form.type === 'supplier_payment') return c.type === 'supplier';
    if (form.type === 'customer_income') return c.type === 'client';
    return true;
  });

  const counterpartiesForImportRow = (row) => {
    if (row.type === 'supplier_payment') return counterparties.filter((c) => c.type === 'supplier');
    if (row.type === 'customer_income') return counterparties.filter((c) => c.type === 'client');
    return counterparties;
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Банк{branchName ? ` · ${branchName}` : ''}</h1>
        {canEdit && (
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={importBusy}
              onClick={() => fileRef.current?.click()}
            >
              {importBusy && modal !== 'import' ? 'Чтение…' : 'Загрузить выписку'}
            </button>
            <button type="button" className="btn btn-primary" onClick={openCreate}>+ Новая операция</button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={onPickStatement}
            />
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>№</th>
                <th>Тип</th>
                <th>Контрагент</th>
                <th>Договор</th>
                <th>Документ</th>
                <th>Дата</th>
                <th>Сумма</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.number}</td>
                  <td>{PAYMENT_TYPES[p.type]}</td>
                  <td>{p.counterparty_name || '—'}</td>
                  <td>{p.contract_number || '—'}</td>
                  <td>{p.document_number || '—'}</td>
                  <td>{formatDate(p.date)}</td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>
                    {canEdit && (
                      <div className="btn-group">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>Изменить</button>
                        {canDelete && (
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(p)}>Удалить</button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={8} className="empty">Операций пока нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'import' && (
        <Modal
          title="Импорт банковской выписки"
          wide
          onClose={() => {
            if (importBusy) return;
            setModal(null);
            setImportRows([]);
            setImportMeta(null);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={importBusy}
                onClick={() => {
                  setModal(null);
                  setImportRows([]);
                  setImportMeta(null);
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={importBusy || selectedImportCount === 0}
                onClick={confirmImport}
              >
                {importBusy ? 'Создание…' : `Создать оплаты (${selectedImportCount})`}
              </button>
            </>
          }
        >
          <p className="text-muted" style={{ marginTop: 0 }}>
            Формат: {importMeta?.format || 'AccReferenceReport'} ({importMeta?.bank || 'Ipak Yuli'}).
            Строки сгруппированы по контрагенту / ИНН.
            {importMeta?.retail_client
              ? ` Эквайринг → «${importMeta.retail_client.name}».`
              : ' Нет клиента «КЛИЕНТ» — Click/Payme/терминал не привяжутся автоматически.'}
          </p>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Фильтр</label>
              <select value={importFilter} onChange={(e) => setImportFilter(e.target.value)}>
                <option value="all">Все ({importRows.length})</option>
                <option value="selected">Выбранные ({selectedImportCount})</option>
                <option value="debit">Расход (дебет)</option>
                <option value="credit">Приход (кредит)</option>
                <option value="unmatched">Без контрагента</option>
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleAllVisible(true)}>
                Выбрать видимые
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleAllVisible(false)}>
                Снять видимые
              </button>
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: '55vh', overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Дата</th>
                  <th>Сумма</th>
                  <th>Тип</th>
                  <th>ИНН</th>
                  <th>Контрагент</th>
                  <th>Договор / канал</th>
                  <th>Назначение</th>
                </tr>
              </thead>
              <tbody>
                {visibleImportRows.map((r) => (
                  <tr key={r.external_ref} style={r.already_imported ? { opacity: 0.55 } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(r.selected)}
                        disabled={r.already_imported}
                        onChange={(e) => updateImportRow(r.external_ref, { selected: e.target.checked })}
                      />
                    </td>
                    <td>{formatDate(r.date)}</td>
                    <td>
                      {r.direction === 'debit' ? '−' : '+'}
                      {formatMoney(r.amount)}
                    </td>
                    <td>
                      <select
                        value={r.type}
                        disabled={r.already_imported}
                        onChange={(e) => updateImportRow(r.external_ref, {
                          type: e.target.value,
                          counterparty_id: '',
                          counterparty_name: null,
                        })}
                      >
                        {Object.entries(PAYMENT_TYPES).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td>{r.inn || '—'}</td>
                    <td>
                      <select
                        value={r.counterparty_id || ''}
                        disabled={r.already_imported}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          const cp = counterparties.find((c) => c.id === id);
                          updateImportRow(r.external_ref, {
                            counterparty_id: id,
                            counterparty_name: cp?.name || null,
                          });
                        }}
                        title={r.match_reason || ''}
                      >
                        <option value="">— не выбран —</option>
                        {counterpartiesForImportRow(r).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.inn ? ` (${c.inn})` : ''}
                          </option>
                        ))}
                      </select>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {r.match_reason || r.name}
                      </div>
                    </td>
                    <td>{r.contract_number || r.channel_label || '—'}</td>
                    <td style={{ maxWidth: 280, fontSize: 12 }} title={r.purpose}>
                      {(r.purpose || '').slice(0, 120)}{(r.purpose || '').length > 120 ? '…' : ''}
                    </td>
                  </tr>
                ))}
                {visibleImportRows.length === 0 && (
                  <tr><td colSpan={8} className="empty">Нет строк</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {modal && modal !== 'import' && (
        <Modal
          title={modal === 'create' ? 'Новая оплата' : 'Редактировать оплату'}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
            </>
          }
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Тип операции</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, counterparty_id: '' })}>
                {Object.entries(PAYMENT_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Дата</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Контрагент</label>
              <select value={form.counterparty_id} onChange={(e) => setForm({ ...form, counterparty_id: e.target.value })}>
                <option value="">— не выбран —</option>
                {filteredCp.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.inn ? ` (${c.inn})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Связанный документ</label>
              <select value={form.document_id} onChange={(e) => setForm({ ...form, document_id: e.target.value })}>
                <option value="">— не выбран —</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>{d.number} — {formatMoney(d.total_amount)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Сумма *</label>
              <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: +e.target.value })} />
            </div>
            <div className="form-group full">
              <label>Комментарий</label>
              <textarea rows={2} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
