import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate, formatDateTime, formatMoney } from '../../api';
import { useAuth } from '../../AuthContext';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import Modal, { ModalCancelButton, useToast } from '../../components/Modal';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import CounterpartySearchSelect from '../../components/CounterpartySearchSelect';
import { todayLocalIso } from '../../utils/date';

export function ReconciliationReport() {
  const DEFAULT_CONTRACT_ID = '__default__';
  const [counterparties, setCounterparties] = useState([]);
  const [counterpartyId, setCounterpartyId] = useState('');
  const [contractId, setContractId] = useState('');
  const [firmId, setFirmId] = useState('');
  const [contracts, setContracts] = useState([]);
  const [firms, setFirms] = useState([]);
  const [act, setAct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [previewDocId, setPreviewDocId] = useState(null);
  const [marks, setMarks] = useState([]);
  const [markForm, setMarkForm] = useState(null);
  const [markSaving, setMarkSaving] = useState(false);
  const { user } = useAuth();
  const { show, Toast } = useToast();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return todayLocalIso(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalIso());
  const { branchName, branchId } = useBranch();

  useEffect(() => {
    api.getCounterparties()
      .then(setCounterparties)
      .catch(() => setCounterparties([]));
  }, [branchId]);

  const selectedCounterparty = useMemo(
    () => counterparties.find((c) => c.id === counterpartyId) || null,
    [counterparties, counterpartyId],
  );

  const counterpartySearchItems = useMemo(
    () => counterparties.map((c) => ({
      id: c.id,
      name: `${c.name} (${c.type === 'supplier' ? 'поставщик' : 'клиент'})`,
    })),
    [counterparties],
  );

  const isSupplier = selectedCounterparty?.type === 'supplier';

  useEffect(() => {
    setContractId('');
    setFirmId('');
    if (!counterpartyId || !isSupplier) {
      setContracts([]);
      setFirms([]);
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      api.getCounterpartyContracts(counterpartyId),
      api.getCounterpartyFirms(counterpartyId),
    ])
      .then(([contractList, firmList]) => {
        if (cancelled) return;
        setContracts(contractList);
        setFirms(firmList || []);
      })
      .catch(() => {
        if (!cancelled) {
          setContracts([{
            id: DEFAULT_CONTRACT_ID,
            number: 'Основной договор',
            date: null,
            virtual: true,
          }]);
          setFirms([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [counterpartyId, isSupplier, branchId]);

  const formatContractOption = (c) => {
    if (!c?.date) return c?.number || 'Основной договор';
    return `${c.number} — ${formatDate(c.date)}`;
  };

  const load = useCallback(() => {
    if (!counterpartyId) {
      setAct(null);
      setLoadError('');
      return;
    }
    setLoading(true);
    setLoadError('');
    api.getReconciliationAct({
      counterparty_id: counterpartyId,
      date_from: dateFrom,
      date_to: dateTo,
      firm_id: firmId,
      contract_id: contractId,
    })
      .then(setAct)
      .catch((e) => {
        setLoadError(e.message || 'Не удалось загрузить акт сверки');
        setAct(null);
      })
      .finally(() => setLoading(false));
  }, [counterpartyId, dateFrom, dateTo, firmId, contractId]);

  useEffect(() => {
    load();
  }, [branchId, load]);

  const loadMarks = useCallback(() => {
    if (!counterpartyId) {
      setMarks([]);
      return;
    }
    api.getReconciliationMarks({ counterparty_id: counterpartyId, firm_id: firmId, contract_id: contractId })
      .then((list) => setMarks(Array.isArray(list) ? list : []))
      .catch(() => setMarks([]));
  }, [counterpartyId, firmId, contractId]);

  useEffect(() => {
    loadMarks();
  }, [branchId, loadMarks]);

  const rows = useMemo(() => {
    if (!act || act.counterparty?.id !== counterpartyId) return [];
    const merged = [...(act.rows || [])];
    const opening = Number(act.opening) || 0;
    if (Math.abs(opening) > 0.005) {
      merged.unshift({
        date: '',
        ref: dateFrom ? `Сальдо на ${formatDate(dateFrom)}` : 'Начальное сальдо',
        operation: 'Входящий остаток',
        debit: opening > 0 ? opening : 0,
        credit: opening < 0 ? Math.abs(opening) : 0,
      });
    }
    let running = 0;
    return merged.map((row) => {
      running += (row.debit || 0) - (row.credit || 0);
      return { ...row, balance: running };
    });
  }, [act, counterpartyId, dateFrom]);

  const totals = useMemo(() => {
    const debit = rows.reduce((s, r) => s + (r.debit || 0), 0);
    const credit = rows.reduce((s, r) => s + (r.credit || 0), 0);
    return { debit, credit, balance: debit - credit };
  }, [rows]);

  const balanceAt = useCallback((date) => {
    let balance = 0;
    for (const r of rows) {
      if (r.date && r.date > date) break;
      balance = r.balance;
    }
    return balance;
  }, [rows]);

  const displayRows = useMemo(() => {
    const inRange = marks
      .filter((m) => (!dateFrom || m.date >= dateFrom) && (!dateTo || m.date <= dateTo))
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at).localeCompare(String(b.created_at)));
    const result = [];
    let mi = 0;
    for (const r of rows) {
      while (mi < inRange.length && r.date && r.date > inRange[mi].date) {
        result.push({ mark: inRange[mi] });
        mi += 1;
      }
      result.push(r);
    }
    while (mi < inRange.length) {
      result.push({ mark: inRange[mi] });
      mi += 1;
    }
    return result;
  }, [rows, marks, dateFrom, dateTo]);

  const lastMark = marks[0] || null;

  const openMarkForm = () => {
    const today = todayLocalIso();
    const date = dateTo && dateTo < today ? dateTo : today;
    setMarkForm({ date, comment: '' });
  };

  const saveMark = async () => {
    if (!markForm?.date) return;
    setMarkSaving(true);
    try {
      await api.createReconciliationMark({
        counterparty_id: counterpartyId,
        firm_id: firmId || null,
        contract_id: contractId || null,
        date: markForm.date,
        balance: balanceAt(markForm.date),
        comment: markForm.comment,
      });
      setMarkForm(null);
      loadMarks();
      show('Сверка отмечена');
    } catch (e) {
      show(e.message || 'Не удалось сохранить отметку', 'error');
    } finally {
      setMarkSaving(false);
    }
  };

  const removeMark = async (mark) => {
    if (!window.confirm(`Удалить отметку сверки на ${formatDate(mark.date)}?`)) return;
    try {
      await api.deleteReconciliationMark(mark.id);
      loadMarks();
    } catch (e) {
      show(e.message || 'Не удалось удалить отметку', 'error');
    }
  };

  const canDeleteMark = (mark) => user?.role === 'admin' || mark.created_by === user?.id;

  return (
    <div>
      <div className="page-header">
        <h1>Акт сверки</h1>
        <BranchChip>{branchName}</BranchChip>
      </div>
      <div className="card report-filters-card">
        <div className="card-header report-toolbar">
          <div className="report-filters">
            <label>
              Контрагент
              <CounterpartySearchSelect
                items={counterpartySearchItems}
                value={counterpartyId}
                onChange={(id) => {
                  setCounterpartyId(id || '');
                  setContractId('');
                  setFirmId('');
                }}
                placeholder="Найти контрагента…"
                className="report-counterparty-search"
              />

            </label>
            {isSupplier && (
              <label>
                Фирма
                <select
                  value={firmId}
                  onChange={(e) => setFirmId(e.target.value)}
                  disabled={!counterpartyId}
                >
                  <option value="">Все фирмы</option>
                  {firms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.inn ? ` (${f.inn})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isSupplier && (
              <label>
                Договор
                <select
                  value={contractId}
                  onChange={(e) => setContractId(e.target.value)}
                  disabled={!counterpartyId}
                >
                  <option value="">Все договоры</option>
                  {contracts.map((c) => (
                    <option key={c.id} value={c.id}>{formatContractOption(c)}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              С
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              По
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
          <span className="report-meta">{loading ? 'Загрузка…' : `Записей: ${rows.length}`}</span>
        </div>
      </div>
      <div className="card">
        {loadError && <div className="alert alert-error" style={{ margin: '12px 16px 0' }}>{loadError}</div>}
        {!counterpartyId && <div className="empty" style={{ padding: 16 }}>Выберите контрагента для сверки.</div>}
        {counterpartyId && (
          <>
            <div className="report-summary">
              <span className="report-summary-item">Начислено: {formatMoney(totals.debit)}</span>
              <span className="report-summary-item">Оплачено: {formatMoney(totals.credit)}</span>
              <span className="report-summary-item"><strong>Сальдо: {formatMoney(totals.balance)}</strong></span>
              <span className="report-summary-spacer" />
              {lastMark ? (
                <span className="report-recon-last" title={lastMark.comment || undefined}>
                  ✓ Последняя сверка: <strong>{formatDate(lastMark.date)}</strong>
                  {' · '}сальдо {formatMoney(lastMark.balance)}
                  {lastMark.created_by_name ? ` · ${lastMark.created_by_name}` : ''}
                </span>
              ) : (
                <span className="report-recon-last is-empty">Сверок ещё не было</span>
              )}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openMarkForm}
                disabled={loading}
              >
                ✓ Отметить сверку
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Основание</th>
                    <th>Операция</th>
                    <th>Начислено</th>
                    <th>Оплачено</th>
                    <th>Сальдо</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r, idx) => (r.mark ? (
                    <tr key={`mark-${r.mark.id}`} className="report-recon-mark-row">
                      <td>{formatDate(r.mark.date)}</td>
                      <td colSpan={4}>
                        <strong>✓ Сверено на {formatDate(r.mark.date)}</strong>
                        <span className="report-recon-mark-meta">
                          {r.mark.created_by_name || '—'}
                          {r.mark.created_at ? `, отмечено ${formatDateTime(r.mark.created_at)}` : ''}
                          {r.mark.comment ? ` — ${r.mark.comment}` : ''}
                        </span>
                      </td>
                      <td>
                        <strong>{formatMoney(r.mark.balance)}</strong>
                        {canDeleteMark(r.mark) && (
                          <button
                            type="button"
                            className="report-recon-mark-del"
                            onClick={() => removeMark(r.mark)}
                            title="Удалить отметку"
                            aria-label="Удалить отметку"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={`${r.ref}-${idx}`}
                      className={r.docId ? 'report-row-clickable' : undefined}
                      onClick={r.docId ? () => setPreviewDocId(r.docId) : undefined}
                      title={r.docId ? 'Открыть документ (только просмотр)' : undefined}
                    >
                      <td>{formatDate(r.date)}</td>
                      <td>{r.docId ? <span className="report-doc-link">{r.ref}</span> : r.ref}</td>
                      <td>{r.operation}</td>
                      <td>{formatMoney(r.debit)}</td>
                      <td>{formatMoney(r.credit)}</td>
                      <td><strong>{formatMoney(r.balance)}</strong></td>
                    </tr>
                  )))}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="empty">{loading ? 'Загрузка…' : 'Нет операций за период'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {previewDocId && (
        <DocumentPreviewModal documentId={previewDocId} onClose={() => setPreviewDocId(null)} />
      )}
      {markForm && (
        <Modal
          title="Отметить сверку"
          onClose={() => setMarkForm(null)}
          className="modal-recon-mark"
          footer={(
            <>
              <button type="button" className="btn btn-primary" onClick={saveMark} disabled={markSaving || !markForm.date}>
                {markSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
              <ModalCancelButton />
            </>
          )}
        >
          <div className="recon-mark-form">
            <div className="recon-mark-cp">
              {selectedCounterparty?.name}
              {firmId && firms.find((f) => f.id === firmId) ? ` · ${firms.find((f) => f.id === firmId).name}` : ''}
              {contractId && contracts.find((c) => c.id === contractId)
                ? ` · ${formatContractOption(contracts.find((c) => c.id === contractId))}`
                : ''}
            </div>
            <label className="form-group">
              Дата сверки
              <input
                type="date"
                value={markForm.date}
                min={dateFrom || undefined}
                max={dateTo || undefined}
                onChange={(e) => setMarkForm({ ...markForm, date: e.target.value })}
              />
            </label>
            <div className="recon-mark-balance">
              Сальдо по акту на эту дату:
              <strong>{formatMoney(markForm.date ? balanceAt(markForm.date) : 0)}</strong>
            </div>
            <label className="form-group">
              Комментарий
              <textarea
                rows={2}
                maxLength={500}
                placeholder="Например: сверились с бухгалтером поставщика, подписан акт"
                value={markForm.comment}
                onChange={(e) => setMarkForm({ ...markForm, comment: e.target.value })}
              />
            </label>
          </div>
        </Modal>
      )}
      {Toast}
    </div>
  );
}
