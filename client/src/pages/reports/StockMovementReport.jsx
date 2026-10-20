import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate } from '../../api';
import { DOC_TYPE_LABELS } from '../../permissions';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import Modal, { ModalCancelButton } from '../../components/Modal';
import DocumentPreviewModal from '../../components/DocumentPreviewModal';
import { todayLocalIso } from '../../utils/date';
import { textMatchesSearch } from '../../utils/searchNormalize';
import SearchHighlight from '../../components/SearchHighlight';
import { formatQty } from './reportUtils';

function movementQty(n) {
  return Math.abs(Number(n) || 0) > 1e-6 ? formatQty(n) : '';
}

function downloadMovementCsv(report, rows, activeKinds, showDepartment) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v) => String(Math.round((Number(v) || 0) * 1000) / 1000).replace('.', ',');
  const head = ['№', 'Наименование товара', 'Ед.'];
  if (showDepartment) head.push('Отдел');
  head.push('Остаток на начало');
  activeKinds.forEach((k) => head.push(`${k.dir === 'in' ? 'Приход' : 'Расход'}: ${k.label}`));
  head.push('Итого приход', 'Итого расход', 'Остаток на конец');
  const lines = [head.map(cell).join(';')];
  rows.forEach((r, i) => {
    const line = [i + 1, r.name, r.unit];
    if (showDepartment) line.push(r.department_name);
    line.push(num(r.opening));
    activeKinds.forEach((k) => line.push(num(r.movements[k.key])));
    line.push(num(r.in_total), num(r.out_total), num(r.closing));
    lines.push(line.map(cell).join(';'));
  });
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dvizhenie-tovarov_${report.date_from || 'start'}_${report.date_to || 'now'}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function mergeMovementRows(rows, kinds) {
  const map = new Map();
  for (const r of rows) {
    const key = `${r.product_id}|${r.variant_id || ''}`;
    let m = map.get(key);
    if (!m) {
      m = {
        ...r,
        department_id: null,
        department_name: '',
        opening: 0,
        in_total: 0,
        out_total: 0,
        closing: 0,
        movements: Object.fromEntries(kinds.map((k) => [k.key, 0])),
      };
      map.set(key, m);
    }
    m.opening += r.opening;
    m.in_total += r.in_total;
    m.out_total += r.out_total;
    m.closing += r.closing;
    kinds.forEach((k) => { m.movements[k.key] += r.movements[k.key] || 0; });
  }
  return [...map.values()];
}

function StockMovementDetailsModal({ row, dateFrom, dateTo, departmentId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [previewDocId, setPreviewDocId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getStockMovementDetails({
      product_id: row.product_id,
      variant_id: row.variant_id || '',
      department_id: departmentId || '',
      date_from: dateFrom,
      date_to: dateTo,
    })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Не удалось загрузить движения'); });
    return () => { cancelled = true; };
  }, [row, dateFrom, dateTo, departmentId]);

  const showDept = !departmentId;
  const colCount = showDept ? 7 : 6;

  return (
    <>
      <Modal
        title={`Движение: ${row.name}`}
        onClose={onClose}
        wide
        className="modal-stock-movement-details"
        footer={<ModalCancelButton onClick={onClose}>Закрыть</ModalCancelButton>}
      >
        <div className="stock-movement-details-meta">
          {row.department_name ? <span>Отдел: <strong>{row.department_name}</strong></span> : <span>Все отделы</span>}
          <span>Период: {dateFrom ? formatDate(dateFrom) : 'с начала'} — {dateTo ? formatDate(dateTo) : 'сегодня'}</span>
          <span>Ед.: {row.unit}</span>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="table-wrap">
          <table className="stock-movement-details-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Документ</th>
                {showDept && <th>Отдел</th>}
                <th>Операция</th>
                <th className="num">Приход</th>
                <th className="num">Расход</th>
                <th className="num">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {data && (
                <tr className="stock-movement-balance-row">
                  <td colSpan={colCount - 1}>Остаток на начало</td>
                  <td className="num"><strong>{formatQty(data.opening)}</strong></td>
                </tr>
              )}
              {data?.lines.map((l, i) => (
                <tr
                  key={`${l.doc_id}-${l.kind}-${i}`}
                  className="report-row-clickable"
                  onClick={() => setPreviewDocId(l.doc_id)}
                  title="Открыть документ"
                >
                  <td>{formatDate(l.date)}</td>
                  <td>
                    <span className="report-doc-link">
                      {DOC_TYPE_LABELS[l.doc_type] || l.doc_type} №{l.doc_number}
                    </span>
                    {l.is_remainder && <span className="stock-movement-tag">остаток</span>}
                  </td>
                  {showDept && <td>{l.department_name}</td>}
                  <td>{l.kind_label}</td>
                  <td className="num stock-movement-in">{movementQty(l.in_qty)}</td>
                  <td className="num stock-movement-out">{movementQty(l.out_qty)}</td>
                  <td className="num">{formatQty(l.balance)}</td>
                </tr>
              ))}
              {data && data.lines.length === 0 && (
                <tr><td colSpan={colCount} className="empty">Нет движений за период</td></tr>
              )}
              {data && (
                <tr className="stock-movement-balance-row">
                  <td colSpan={colCount - 1}>Остаток на конец</td>
                  <td className="num"><strong>{formatQty(data.closing)}</strong></td>
                </tr>
              )}
              {!data && !error && (
                <tr><td colSpan={colCount} className="empty">Загрузка…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>
      {previewDocId && (
        <DocumentPreviewModal documentId={previewDocId} onClose={() => setPreviewDocId(null)} />
      )}
    </>
  );
}

export function StockMovementReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return todayLocalIso(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalIso());
  const [departmentId, setDepartmentId] = useState('');
  const [mergeDepartments, setMergeDepartments] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [onlyTransfers, setOnlyTransfers] = useState(false);
  const [detailsRow, setDetailsRow] = useState(null);
  const { branchName, branchId } = useBranch();

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.getStockMovementReport({ date_from: dateFrom, date_to: dateTo, department_id: departmentId })
      .then(setReport)
      .catch((e) => {
        setLoadError(e.message || 'Не удалось загрузить отчёт');
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, departmentId]);

  useEffect(() => {
    load();
  }, [branchId, load]);

  useEffect(() => {
    setDepartmentId('');
  }, [branchId]);

  const kinds = useMemo(() => report?.kinds || [], [report]);
  const departments = report?.departments || [];
  const merged = !departmentId && mergeDepartments;
  const showDepartment = !departmentId && !mergeDepartments;

  const baseRows = useMemo(() => {
    if (!report) return [];
    return merged ? mergeMovementRows(report.rows, kinds) : report.rows;
  }, [report, merged, kinds]);

  const categoryOptions = useMemo(() => {
    const map = new Map();
    baseRows.forEach((r) => { if (r.category_id && r.category_name) map.set(r.category_id, r.category_name); });
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [baseRows]);

  const rows = useMemo(() => {
    const q = search.trim();
    return baseRows.filter((r) => {
      if (categoryId && r.category_id !== categoryId) return false;
      if (onlyTransfers && !(r.movements.transfer_in > 0 || r.movements.transfer_out > 0)) return false;
      if (!q) return true;
      return textMatchesSearch([r.name, r.department_name, r.category_name].filter(Boolean).join(' '), q);
    });
  }, [baseRows, categoryId, onlyTransfers, search]);

  const activeKinds = useMemo(
    () => kinds.filter((k) => rows.some((r) => Math.abs(r.movements[k.key] || 0) > 1e-6)),
    [kinds, rows],
  );
  const inKinds = activeKinds.filter((k) => k.dir === 'in');
  const outKinds = activeKinds.filter((k) => k.dir === 'out');

  return (
    <div>
      <div className="page-header">
        <h1>Движение товаров</h1>
        <BranchChip>{branchName}</BranchChip>
      </div>

      <div className="card report-filters-card">
        <div className="card-header report-toolbar">
          <div className="report-filters">
            <label>
              С
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              По
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label>
              Отдел
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Все отделы</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label>
              Категория
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Все</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="stock-movement-search">
              Поиск
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Товар или отдел"
              />
            </label>
            {!departmentId && (
              <label className="stock-filter-toggle">
                <input type="checkbox" checked={mergeDepartments} onChange={(e) => setMergeDepartments(e.target.checked)} />
                <span>Свод по филиалу</span>
              </label>
            )}
            <label className="stock-filter-toggle">
              <input type="checkbox" checked={onlyTransfers} onChange={(e) => setOnlyTransfers(e.target.checked)} />
              <span>Только с перемещениями</span>
            </label>
          </div>
          <div className="stock-movement-actions">
            <span className="report-meta">{loading ? 'Загрузка…' : `Позиций: ${rows.length}`}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!report || rows.length === 0}
              onClick={() => downloadMovementCsv(report, rows, activeKinds, showDepartment)}
            >
              Excel (CSV)
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        {loadError && <div className="alert alert-error" style={{ margin: '12px 16px 0' }}>{loadError}</div>}
        <div className="table-wrap stock-movement-wrap">
          <table className="stock-movement-table">
            <thead>
              <tr>
                <th rowSpan={2} className="stock-movement-idx">№</th>
                <th rowSpan={2} className="stock-movement-name">Наименование товара</th>
                <th rowSpan={2}>Ед.</th>
                {showDepartment && <th rowSpan={2}>Отдел</th>}
                <th rowSpan={2} className="num stock-movement-balance">Остаток на начало</th>
                <th colSpan={inKinds.length + 1} className="stock-movement-group stock-movement-in">Приход</th>
                <th colSpan={outKinds.length + 1} className="stock-movement-group stock-movement-out">Расход</th>
                <th rowSpan={2} className="num stock-movement-balance">Остаток на конец</th>
              </tr>
              <tr>
                {inKinds.map((k) => <th key={k.key} className="num stock-movement-kind">{k.label}</th>)}
                <th className="num stock-movement-kind stock-movement-total">Итого</th>
                {outKinds.map((k) => <th key={k.key} className="num stock-movement-kind">{k.label}</th>)}
                <th className="num stock-movement-kind stock-movement-total">Итого</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.product_id}|${r.variant_id || ''}|${r.department_id || ''}`}
                  className="report-row-clickable"
                  onClick={() => setDetailsRow(r)}
                  title="Показать документы"
                >
                  <td className="stock-movement-idx">{i + 1}</td>
                  <td className="stock-movement-name">
                    <SearchHighlight text={r.name} query={search} />
                  </td>
                  <td>{r.unit}</td>
                  {showDepartment && <td>{r.department_name}</td>}
                  <td className="num stock-movement-balance">{formatQty(r.opening)}</td>
                  {inKinds.map((k) => <td key={k.key} className="num">{movementQty(r.movements[k.key])}</td>)}
                  <td className="num stock-movement-total stock-movement-in">{movementQty(r.in_total)}</td>
                  {outKinds.map((k) => <td key={k.key} className="num">{movementQty(r.movements[k.key])}</td>)}
                  <td className="num stock-movement-total stock-movement-out">{movementQty(r.out_total)}</td>
                  <td className={`num stock-movement-balance${r.closing < -1e-6 ? ' stock-movement-negative' : ''}`}>
                    {formatQty(r.closing)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7 + activeKinds.length + (showDepartment ? 1 : 0)} className="empty">
                    {loading ? 'Загрузка…' : 'Нет движений за выбранный период'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailsRow && (
        <StockMovementDetailsModal
          row={detailsRow}
          dateFrom={dateFrom}
          dateTo={dateTo}
          departmentId={merged ? '' : (detailsRow.department_id || departmentId)}
          onClose={() => setDetailsRow(null)}
        />
      )}
    </div>
  );
}
