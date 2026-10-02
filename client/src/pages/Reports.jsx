import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { api, formatDate, formatDateTime, formatMoney } from '../api';
import { DOC_TYPE_LABELS } from '../permissions';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import Modal, { ModalCancelButton, useToast } from '../components/Modal';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import CounterpartySearchSelect from '../components/CounterpartySearchSelect';
import { todayLocalIso } from '../utils/date';
import { textMatchesSearch } from '../utils/searchNormalize';
import SearchHighlight from '../components/SearchHighlight';
import { downloadSupplierDebtReport } from '../utils/supplierDebtExport';
import {
  deleteSupplierDebtTemplate,
  getLastSupplierDebtTemplateId,
  listSupplierDebtTemplates,
  saveSupplierDebtTemplate,
  setLastSupplierDebtTemplateId,
} from '../utils/supplierDebtTemplates';
import ReportSupplierMultiSelect from '../components/ReportSupplierMultiSelect';

function formatQty(n) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(rounded);
}

function SortHeader({ label, sortKey, activeKey, direction, onSort, className = '' }) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`sortable-th ${className}${active ? ' is-sorted' : ''}`}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="sortable-th-btn"
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="sortable-th-icons" aria-hidden="true">
          <span className={`sort-arrow up${active && direction === 'asc' ? ' active' : ''}`}>▲</span>
          <span className={`sort-arrow down${active && direction === 'desc' ? ' active' : ''}`}>▼</span>
        </span>
      </button>
    </th>
  );
}

function StockTableColgroup({ showDepartmentColumn, showActions }) {
  return (
    <colgroup>
      <col className="col-index" />
      {showDepartmentColumn && <col className="col-dept" />}
      <col className="col-product" />
      <col className="col-category" />
      <col className="col-unit" />
      <col className="col-num" />
      <col className="col-num" />
      <col className="col-num" />
      {showActions && <col className="col-actions" />}
    </colgroup>
  );
}

function StockTableHeadRow({ showDepartmentColumn, showActions, sortKey, sortDir, onSort }) {
  return (
    <tr>
      <th className="col-index">№</th>
      {showDepartmentColumn && (
        <SortHeader
          label="Склад"
          sortKey="department_name"
          activeKey={sortKey}
          direction={sortDir}
          onSort={onSort}
        />
      )}
      <SortHeader
        label="Товар"
        sortKey="name"
        activeKey={sortKey}
        direction={sortDir}
        onSort={onSort}
      />
      <SortHeader
        label="Категория"
        sortKey="category_name"
        activeKey={sortKey}
        direction={sortDir}
        onSort={onSort}
      />
      <SortHeader
        label="Ед."
        sortKey="unit"
        activeKey={sortKey}
        direction={sortDir}
        onSort={onSort}
        className="col-unit"
      />
      <SortHeader
        label="Остаток"
        sortKey="stock"
        activeKey={sortKey}
        direction={sortDir}
        onSort={onSort}
        className="col-num"
      />
      <SortHeader
        label="Себестоимость склада"
        sortKey="unitCost"
        activeKey={sortKey}
        direction={sortDir}
        onSort={onSort}
        className="col-num"
      />
      <SortHeader
        label="Сумма"
        sortKey="total"
        activeKey={sortKey}
        direction={sortDir}
        onSort={onSort}
        className="col-num"
      />
      {showActions && <th className="col-actions" aria-label="Действия" />}
    </tr>
  );
}

function StockReport() {
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [departmentId, setDepartmentId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [headStuck, setHeadStuck] = useState(false);
  const [headLayout, setHeadLayout] = useState({ left: 0, width: 0, height: 0 });
  const [clearingKey, setClearingKey] = useState('');
  const tableWrapRef = useRef(null);
  const theadRef = useRef(null);
  const { branchName, branchId } = useBranch();
  const { user } = useAuth();
  const canZeroStock = user?.role === 'admin';

  const loadRows = useCallback(() => {
    const params = { only_in_stock: onlyInStock ? '1' : '0' };
    if (departmentId) params.department_id = departmentId;
    return api.getStockReport(params).then(setRows).catch(console.error);
  }, [branchId, departmentId, onlyInStock]);

  useEffect(() => {
    api.getDepartments({ active: '1' }).then(setDepartments).catch(console.error);
  }, [branchId]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const handleZeroStock = async (row) => {
    const qtyLabel = `${formatQty(row.stock)} ${row.unit}`;
    if (!window.confirm(`Обнулить остаток «${row.name}» (${qtyLabel})?\n\nИспользуйте, если остаток появился без документов.`)) {
      return;
    }
    setClearingKey(row.rowKey);
    try {
      await api.zeroStockPosition({
        department_id: row.department_id,
        product_id: row.product_id,
        variant_id: row.variant_id || null,
      });
      await loadRows();
    } catch (err) {
      window.alert(err.message || 'Не удалось обнулить остаток');
    } finally {
      setClearingKey('');
    }
  };

  const selectedDepartment = departments.find((d) => d.id === departmentId);
  const showDepartmentColumn = !departmentId;

  useEffect(() => {
    if (!showDepartmentColumn && sortKey === 'department_name') {
      setSortKey('name');
      setSortDir('asc');
    }
  }, [showDepartmentColumn, sortKey]);

  const categoryOptions = useMemo(() => {
    const map = new Map();
    for (const row of rows) {
      if (row.category_id && row.category_name) {
        map.set(row.category_id, row.category_name);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim();
    return rows.filter((row) => {
      if (categoryId && row.category_id !== categoryId) return false;
      if (!q) return true;
      const haystack = [
        row.name,
        row.category_name,
        row.department_name,
        row.unit,
      ].filter(Boolean).join(' ');
      return textMatchesSearch(haystack, q);
    });
  }, [rows, search, categoryId]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(['stock', 'unitCost', 'total'].includes(key) ? 'desc' : 'asc');
  };

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const dir = sortDir === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      switch (sortKey) {
        case 'department_name':
          return dir * (a.department_name || '').localeCompare(b.department_name || '', 'ru');
        case 'name':
          return dir * (a.name || '').localeCompare(b.name || '', 'ru');
        case 'category_name':
          return dir * (a.category_name || '').localeCompare(b.category_name || '', 'ru');
        case 'unit':
          return dir * (a.unit || '').localeCompare(b.unit || '', 'ru');
        case 'stock':
          return dir * ((a.stock || 0) - (b.stock || 0));
        case 'unitCost':
          return dir * ((a.unitCost || 0) - (b.unitCost || 0));
        case 'total':
          return dir * ((a.total || 0) - (b.total || 0));
        default:
          return 0;
      }
    });

    return list;
  }, [filteredRows, sortKey, sortDir]);

  const hasActiveFilters = search.trim() || categoryId || departmentId;

  const resetFilters = () => {
    setSearch('');
    setCategoryId('');
    setDepartmentId('');
  };

  const totalQty = filteredRows.reduce((s, row) => s + row.stock, 0);
  const totalValue = filteredRows.reduce((s, row) => s + row.total, 0);
  const colCount = (showDepartmentColumn ? 8 : 7) + (canZeroStock ? 1 : 0);

  const locationLabel = useMemo(() => {
    const parts = [branchName];
    if (selectedDepartment) parts.push(selectedDepartment.name);
    return parts.filter(Boolean).join(' · ');
  }, [branchName, selectedDepartment]);

  const tableClassName = `stock-report-table${showDepartmentColumn ? '' : ' no-dept'}`;

  const updateStickyHead = useCallback(() => {
    const wrap = tableWrapRef.current;
    const thead = theadRef.current;
    if (!wrap || !thead) return;

    const wrapRect = wrap.getBoundingClientRect();
    const headHeight = thead.getBoundingClientRect().height;
    const shouldStick = wrapRect.top <= 0 && wrapRect.bottom > headHeight;

    setHeadStuck(shouldStick);
    setHeadLayout({
      left: wrapRect.left,
      width: wrapRect.width,
      height: headHeight,
    });
  }, []);

  useEffect(() => {
    updateStickyHead();
    window.addEventListener('scroll', updateStickyHead, { passive: true });
    window.addEventListener('resize', updateStickyHead);
    return () => {
      window.removeEventListener('scroll', updateStickyHead);
      window.removeEventListener('resize', updateStickyHead);
    };
  }, [updateStickyHead, showDepartmentColumn, sortedRows.length, sortKey, sortDir]);

  return (
    <div className="stock-report-page">
      <div className="stock-report-top">
        <div className="stock-report-head">
          <h1>Остатки на складе</h1>
          <BranchChip className="stock-location-chip">{locationLabel}</BranchChip>
        </div>

        <div className="stock-report-kpi">
          <div className="stat-card stock-kpi-card">
            <span className="label">Позиций</span>
            <span className="value">{filteredRows.length}</span>
            {hasActiveFilters && rows.length !== filteredRows.length && (
              <span className="stock-kpi-hint">из {rows.length}</span>
            )}
          </div>
          <div className="stat-card stock-kpi-card">
            <span className="label">Остаток</span>
            <span className="value">{formatQty(totalQty)}</span>
          </div>
          <div className="stat-card stock-kpi-card stock-kpi-card-accent">
            <span className="label">Сумма</span>
            <span className="value">{formatMoney(totalValue)}</span>
          </div>
        </div>
      </div>

      <div className="card stock-report-toolbar">
        <div className="stock-toolbar-grid">
          <div className="stock-search-wrap">
            <span className="stock-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              className="stock-search-input"
              placeholder="Поиск по товару, категории, складу..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="stock-search-clear"
                aria-label="Очистить поиск"
                onClick={() => setSearch('')}
              >
                ×
              </button>
            )}
          </div>

          <label className="stock-filter-field">
            <span>Категория</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Все категории</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label className="stock-filter-field">
            <span>Склад / отдел</span>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">Все склады</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>

          <div className="stock-toolbar-actions">
            <label className="stock-filter-toggle">
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={(e) => setOnlyInStock(e.target.checked)}
              />
              <span>Только с остатком</span>
            </label>

            {hasActiveFilters && (
              <button type="button" className="btn btn-ghost btn-sm stock-filter-reset" onClick={resetFilters}>
                Сбросить
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card stock-report-table-card">
        {headStuck && (
          <div
            className="stock-table-head-pin"
            style={{ left: headLayout.left, width: headLayout.width }}
          >
            <table className={tableClassName}>
              <StockTableColgroup showDepartmentColumn={showDepartmentColumn} showActions={canZeroStock} />
              <thead>
                <StockTableHeadRow
                  showDepartmentColumn={showDepartmentColumn}
                  showActions={canZeroStock}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                />
              </thead>
            </table>
          </div>
        )}

        <div className="stock-table-body-wrap" ref={tableWrapRef}>
          <table className={tableClassName}>
            <StockTableColgroup showDepartmentColumn={showDepartmentColumn} showActions={canZeroStock} />
            <thead ref={theadRef}>
              <StockTableHeadRow
                showDepartmentColumn={showDepartmentColumn}
                showActions={canZeroStock}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
              />
            </thead>
            <tbody>
              {sortedRows.map((row, index) => (
                <tr key={row.rowKey}>
                  <td className="col-index">{index + 1}</td>
                  {showDepartmentColumn && (
                    <td>
                      <span className="dept-badge">{row.department_name}</span>
                    </td>
                  )}
                  <td className="product-name">
                    {search.trim() ? <SearchHighlight text={row.name} query={search} /> : row.name}
                  </td>
                  <td className="category-cell">{row.category_name || '—'}</td>
                  <td className="col-unit">{row.unit}</td>
                  <td className="col-num">{formatQty(row.stock)}</td>
                  <td className="col-num muted">{formatMoney(row.unitCost)}</td>
                  <td className="col-num strong">{formatMoney(row.total)}</td>
                  {canZeroStock && (
                    <td className="col-actions">
                      {row.stock > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm stock-zero-btn"
                          onClick={() => handleZeroStock(row)}
                          disabled={clearingKey === row.rowKey}
                          title="Обнулить остаток без документа"
                        >
                          {clearingKey === row.rowKey ? '…' : 'Очистить'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="empty stock-report-empty">
                    {rows.length === 0 ? 'Нет данных по остаткам' : 'Ничего не найдено по фильтрам'}
                  </td>
                </tr>
              )}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="report-total-row">
                  <td colSpan={showDepartmentColumn ? 5 : 4}><strong>Итого</strong></td>
                  <td className="col-num"><strong>{formatQty(totalQty)}</strong></td>
                  <td className="col-num" />
                  <td className="col-num strong"><strong>{formatMoney(totalValue)}</strong></td>
                  {canZeroStock && <td className="col-actions" />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

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

function StockMovementReport() {
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

function DocumentsReport() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return todayLocalIso(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalIso());
  const [typeFilter, setTypeFilter] = useState('');
  const { branchName, branchId } = useBranch();

  const loadDocuments = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = { status: 'confirmed' };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (typeFilter) params.type = typeFilter;
    api.getDocuments(params)
      .then(setDocuments)
      .catch((e) => {
        console.error(e);
        setLoadError(e.message || 'Не удалось загрузить документы');
        setDocuments([]);
      })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, typeFilter]);

  useEffect(() => {
    loadDocuments();
  }, [branchId, loadDocuments]);

  const rows = documents;

  const totals = useMemo(() => {
    const map = {};
    for (const d of rows) {
      map[d.type] = (map[d.type] || 0) + (d.total_amount || 0);
    }
    return map;
  }, [rows]);

  const grandTotal = rows.reduce((s, d) => s + (d.total_amount || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h1>Документы за период</h1>
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
              Тип
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">Все</option>
                {Object.entries(DOC_TYPE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <span className="report-meta">
            {loading ? 'Загрузка…' : `Документов: ${rows.length}`}
          </span>
        </div>
      </div>

      <div className="card">
        {loadError && <div className="alert alert-error" style={{ margin: '12px 16px 0' }}>{loadError}</div>}
        {Object.keys(totals).length > 0 && (
          <div className="report-summary">
            {Object.entries(totals).map(([type, sum]) => (
              <span key={type} className={`report-summary-item badge badge-${type}`}>
                {DOC_TYPE_LABELS[type] || type}: {formatMoney(sum)}
              </span>
            ))}
            <span className="report-summary-item"><strong>Всего: {formatMoney(grandTotal)}</strong></span>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Тип</th>
                <th>Дата</th>
                <th>Контрагент / маршрут</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{d.number}</td>
                  <td>
                    <span className={`badge badge-${d.type}`}>
                      {DOC_TYPE_LABELS[d.type] || d.type}
                    </span>
                  </td>
                  <td>{formatDate(d.date)}</td>
                  <td>
                    {d.type === 'peremeshchenie'
                      ? `${d.from_branch_name || d.from_department_name || '—'} → ${d.to_branch_name || d.to_department_name || '—'}`
                      : (d.counterparty_name || '—')}
                  </td>
                  <td>{formatMoney(d.total_amount)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    {loading ? 'Загрузка…' : 'Нет проведённых документов за выбранный период'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CounterpartyDebtReport({ kind }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [includeUnlinkedPayments, setIncludeUnlinkedPayments] = useState(true);
  const [search, setSearch] = useState('');
  const { branchId } = useBranch();

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    setReport(null);
    const params = {};
    if (includeZero) params.include_zero = '1';
    if (includeUnlinkedPayments) params.include_unlinked_payments = '1';
    const fetcher = kind === 'debtors' ? api.getDebtorsReport : api.getCreditorsReport;
    fetcher(params)
      .then(setReport)
      .catch((e) => {
        console.error(e);
        setLoadError(e.message || 'Не удалось загрузить отчёт');
        setReport({ rows: [], count: 0, total_balance: 0 });
      })
      .finally(() => setLoading(false));
  }, [includeZero, includeUnlinkedPayments, kind, branchId]);

  useEffect(() => { load(); }, [load, branchId]);

  const rows = useMemo(() => {
    const list = report?.rows || [];
    const q = search.trim();
    if (!q) return list;
    return list.filter((r) => [r.name, r.phone, r.email].some((v) => textMatchesSearch(v, q)));
  }, [report, search]);

  const totalBalance = useMemo(
    () => rows.reduce((s, r) => s + r.balance, 0),
    [rows],
  );

  const balanceLabel = kind === 'debtors' ? 'Дебиторская задолженность' : 'Кредиторская задолженность';
  const hasSearch = !!search.trim();
  const allCount = report?.rows?.length ?? 0;

  return (
    <div className="debt-report-page">
      <div className="stock-report-top">
        <div className="stock-report-kpi">
          <div className="stat-card stock-kpi-card">
            <span className="label">Контрагентов</span>
            <span className="value">{rows.length}</span>
            {hasSearch && allCount !== rows.length && (
              <span className="stock-kpi-hint">из {allCount}</span>
            )}
          </div>
          <div className={`stat-card stock-kpi-card debt-kpi-total debt-kpi-${kind}`}>
            <span className="label">{balanceLabel}</span>
            <span className="value">{formatMoney(totalBalance)}</span>
          </div>
        </div>
      </div>

      <div className="card stock-report-toolbar">
        <div className="stock-toolbar-grid debt-toolbar-grid">
          <div className="stock-search-wrap">
            <span className="stock-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              className="stock-search-input"
              placeholder="Поиск по названию, телефону, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="stock-search-clear"
                aria-label="Очистить поиск"
                onClick={() => setSearch('')}
              >
                ×
              </button>
            )}
          </div>

          <div className="stock-toolbar-actions debt-toolbar-actions">
            <label className="stock-filter-toggle">
              <input
                type="checkbox"
                checked={includeZero}
                onChange={(e) => setIncludeZero(e.target.checked)}
              />
              <span>С операциями без долга</span>
            </label>
            <label className="stock-filter-toggle">
              <input
                type="checkbox"
                checked={includeUnlinkedPayments}
                onChange={(e) => setIncludeUnlinkedPayments(e.target.checked)}
              />
              <span>Учитывать оплаты без документа</span>
            </label>
            {(hasSearch || includeZero || includeUnlinkedPayments) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm stock-filter-reset"
                onClick={() => { setSearch(''); setIncludeZero(false); setIncludeUnlinkedPayments(false); }}
              >
                Сбросить
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card debt-report-table-card">
        {loadError && <div className="alert alert-error" style={{ margin: '12px 16px 0' }}>{loadError}</div>}
        <div className="card-header debt-report-table-head">
          <strong>{kind === 'debtors' ? 'Задолженность клиентов' : 'Задолженность поставщикам'}</strong>
          <span className="report-meta">{loading ? 'Загрузка…' : `${rows.length} записей`}</span>
        </div>
        <div className="table-wrap">
          <table className="debt-report-table">
            <thead>
              <tr>
                <th className="col-index">№</th>
                <th>Контрагент</th>
                <th>Контакты</th>
                <th className="col-num">По документам</th>
                <th className="col-num">Оплачено</th>
                <th className="col-num">Нач. сальдо</th>
                <th className="col-num">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="col-index">{index + 1}</td>
                  <td className="debt-name-cell">
                    <strong>
                      {search.trim() ? <SearchHighlight text={row.name} query={search} /> : row.name}
                    </strong>
                  </td>
                  <td className="debt-contact-cell">
                    {row.phone && (
                      <span>
                        {search.trim() ? <SearchHighlight text={row.phone} query={search} /> : row.phone}
                      </span>
                    )}
                    {row.email && (
                      <span className="debt-email">
                        {search.trim() ? <SearchHighlight text={row.email} query={search} /> : row.email}
                      </span>
                    )}
                    {!row.phone && !row.email && '—'}
                  </td>
                  <td className="col-num">{formatMoney(row.charged)}</td>
                  <td className="col-num muted">{formatMoney(row.paid)}</td>
                  <td className="col-num muted">{formatMoney(row.opening_balance || 0)}</td>
                  <td className={`col-num strong debt-balance-${kind}`}>{formatMoney(row.balance)}</td>
                </tr>
              ))}
              {(loading || !report) && (
                <tr>
                  <td colSpan={7} className="empty">Загрузка…</td>
                </tr>
              )}
              {report && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty debt-report-empty">
                    <span className="debt-empty-title">Задолженности нет</span>
                    <span className="debt-empty-hint">
                      {kind === 'debtors'
                        ? 'Появится после проведённых расходов клиентам с неполной оплатой.'
                        : 'Появится после проведённых приходов от поставщиков с неполной оплатой.'}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="report-total-row">
                  <td colSpan={6}><strong>Итого</strong></td>
                  <td className={`col-num strong debt-balance-${kind}`}>
                    <strong>{formatMoney(totalBalance)}</strong>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function ReconciliationReport() {
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

function SupplierReturnsReport() {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return todayLocalIso(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalIso());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const { branchName, branchId } = useBranch();

  useEffect(() => {
    api.getCounterparties('supplier')
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [branchId]);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = { type: 'return_supplier', status: 'confirmed' };
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api.getDocuments(params)
      .then((docs) => {
        const filtered = supplierId ? docs.filter((d) => d.counterparty_id === supplierId) : docs;
        setRows(filtered);
      })
      .catch((e) => {
        setLoadError(e.message || 'Не удалось загрузить отчёт по возвратам');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, supplierId]);

  useEffect(() => {
    load();
  }, [branchId, load]);

  const total = rows.reduce((s, r) => s + (r.total_amount || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h1>Возвраты поставщикам</h1>
        <BranchChip>{branchName}</BranchChip>
      </div>
      <div className="card report-filters-card">
        <div className="card-header report-toolbar">
          <div className="report-filters">
            <label>
              Поставщик
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Все поставщики</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              С
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label>
              По
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
          <span className="report-meta">{loading ? 'Загрузка…' : `Документов: ${rows.length}`}</span>
        </div>
      </div>

      <div className="card">
        {loadError && <div className="alert alert-error" style={{ margin: '12px 16px 0' }}>{loadError}</div>}
        <div className="report-summary">
          <span className="report-summary-item"><strong>Сумма возвратов: {formatMoney(total)}</strong></span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Дата</th>
                <th>Поставщик</th>
                <th>Сумма</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{d.number}</td>
                  <td>{formatDate(d.date)}</td>
                  <td>{d.counterparty_name || '—'}</td>
                  <td>{formatMoney(d.total_amount)}</td>
                  <td>{d.comment || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">{loading ? 'Загрузка…' : 'Нет возвратов за выбранный период'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function sameIdSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map(String));
  return a.every((id) => setB.has(String(id)));
}

function SupplierDebtMovementReport() {
  const [report, setReport] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierIds, setSupplierIds] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return todayLocalIso(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalIso());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [exporting, setExporting] = useState(false);
  const { branchName, branchId } = useBranch();
  const { show, Toast } = useToast();
  const restoredBranchRef = useRef(null);

  const reloadTemplates = useCallback(() => {
    setTemplates(listSupplierDebtTemplates(branchId));
  }, [branchId]);

  useEffect(() => {
    reloadTemplates();
  }, [reloadTemplates]);

  useEffect(() => {
    let cancelled = false;
    api.getCounterparties('supplier')
      .then((list) => {
        if (cancelled) return;
        setSuppliers(list);
        if (restoredBranchRef.current === branchId) return;
        restoredBranchRef.current = branchId;
        const lastId = getLastSupplierDebtTemplateId(branchId);
        const tmpl = listSupplierDebtTemplates(branchId).find((t) => t.id === lastId);
        if (!tmpl) {
          setActiveTemplateId('');
          setSupplierIds([]);
          return;
        }
        const known = new Set(list.map((s) => String(s.id)));
        const ids = tmpl.supplierIds.filter((id) => known.has(String(id)));
        setActiveTemplateId(tmpl.id);
        setSupplierIds(ids);
      })
      .catch(() => {
        if (!cancelled) {
          setSuppliers([]);
          setActiveTemplateId('');
          setSupplierIds([]);
        }
      });
    return () => { cancelled = true; };
  }, [branchId]);

  const load = useCallback(() => {
    if (!dateFrom || !dateTo) {
      setReport(null);
      return;
    }
    setLoading(true);
    setLoadError('');
    const params = { date_from: dateFrom, date_to: dateTo };
    if (supplierIds.length) params.supplier_ids = supplierIds;
    api.getSupplierDebtMovementReport(params)
      .then(setReport)
      .catch((e) => {
        setLoadError(e.message || 'Не удалось загрузить отчёт');
        setReport({ rows: [], totals: { opening_debt: 0, prihod: 0, payment: 0, closing_debt: 0 }, count: 0 });
      })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, supplierIds]);

  useEffect(() => {
    load();
  }, [branchId, load]);

  const rows = report?.rows || [];
  const totals = report?.totals || { opening_debt: 0, prihod: 0, payment: 0, closing_debt: 0 };

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === activeTemplateId) || null,
    [templates, activeTemplateId],
  );

  const selectedSupplierLabel = useMemo(() => {
    if (!supplierIds.length) return '';
    const names = suppliers
      .filter((s) => supplierIds.includes(s.id))
      .map((s) => s.name);
    if (!names.length) return `Выбрано поставщиков: ${supplierIds.length}`;
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} и ещё ${names.length - 3}`;
  }, [supplierIds, suppliers]);

  const handleSupplierIdsChange = (nextIds) => {
    setSupplierIds(nextIds);
    if (activeTemplate && sameIdSet(nextIds, activeTemplate.supplierIds)) return;
    setActiveTemplateId('');
    setLastSupplierDebtTemplateId(branchId, null);
  };

  const applyTemplate = (templateId) => {
    if (!templateId) {
      setActiveTemplateId('');
      setLastSupplierDebtTemplateId(branchId, null);
      return;
    }
    const tmpl = templates.find((t) => t.id === templateId);
    if (!tmpl) return;
    const known = new Set(suppliers.map((s) => String(s.id)));
    const ids = tmpl.supplierIds.filter((id) => known.has(String(id)));
    setActiveTemplateId(tmpl.id);
    setSupplierIds(ids);
    setLastSupplierDebtTemplateId(branchId, tmpl.id);
  };

  const handleSaveTemplate = () => {
    if (!supplierIds.length) {
      show('Сначала выберите поставщиков', 'error');
      return;
    }
    const defaultName = activeTemplate?.name || '';
    const name = window.prompt(
      activeTemplate
        ? 'Название шаблона. То же имя — обновить; другое — сохранить как новый'
        : 'Название нового шаблона',
      defaultName,
    );
    if (name == null) return;
    const trimmed = String(name).trim();
    if (!trimmed) {
      show('Укажите название шаблона', 'error');
      return;
    }
    const updateExisting = Boolean(activeTemplate && trimmed === activeTemplate.name);
    try {
      const saved = saveSupplierDebtTemplate(branchId, {
        id: updateExisting ? activeTemplate.id : null,
        name: trimmed,
        supplierIds,
      });
      reloadTemplates();
      setActiveTemplateId(saved.id);
      show(updateExisting ? 'Шаблон обновлён' : 'Шаблон сохранён');
    } catch (e) {
      show(e.message || 'Не удалось сохранить шаблон', 'error');
    }
  };

  const handleDeleteTemplate = () => {
    if (!activeTemplate) return;
    if (!window.confirm(`Удалить шаблон «${activeTemplate.name}»?`)) return;
    deleteSupplierDebtTemplate(branchId, activeTemplate.id);
    reloadTemplates();
    setActiveTemplateId('');
    show('Шаблон удалён');
  };

  const handleExport = async (format) => {
    if (exporting || loading) return;
    setExporting(true);
    try {
      await downloadSupplierDebtReport({
        branchName,
        dateFrom,
        dateTo,
        rows,
        totals,
        format,
        supplierFilterLabel: selectedSupplierLabel,
      });
      show(format === 'pdf' ? 'PDF сохранён' : 'JPEG сохранён');
    } catch (e) {
      show(e.message || 'Не удалось скачать отчёт', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {Toast}
      <div className="page-header">
        <h1>Долги поставщикам</h1>
        <div className="btn-group">
          <BranchChip>{branchName}</BranchChip>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={exporting || loading}
            onClick={() => handleExport('jpeg')}
          >
            {exporting ? 'Сохранение…' : 'Скачать JPEG'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={exporting || loading}
            onClick={() => handleExport('pdf')}
          >
            Скачать PDF
          </button>
        </div>
      </div>
      <div className="card report-filters-card">
        <div className="card-header report-toolbar">
          <div className="report-filters">
            <label>
              С
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label>
              По
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <label className="report-filters-supplier-multi">
              Поставщики
              <ReportSupplierMultiSelect
                suppliers={suppliers}
                value={supplierIds}
                onChange={handleSupplierIdsChange}
                disabled={loading}
              />
            </label>
            <label className="report-filters-template">
              Шаблон
              <div className="report-template-row">
                <select
                  value={activeTemplateId}
                  disabled={loading}
                  onChange={(e) => applyTemplate(e.target.value)}
                >
                  <option value="">Не выбран</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.supplierIds.length})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={loading || !supplierIds.length}
                  onClick={handleSaveTemplate}
                  title={activeTemplate ? 'Обновить шаблон текущим набором' : 'Сохранить набор как шаблон'}
                >
                  {activeTemplate ? 'Обновить' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={loading || !activeTemplate}
                  onClick={handleDeleteTemplate}
                >
                  Удалить
                </button>
              </div>
            </label>
          </div>
          <span className="report-meta">{loading ? 'Загрузка…' : `Строк: ${rows.length}`}</span>
        </div>
      </div>

      <div className="card">
        {loadError && <div className="alert alert-error" style={{ margin: '12px 16px 0' }}>{loadError}</div>}
        <div className="table-wrap">
          <table className="supplier-debt-report-table">
            <thead>
              <tr>
                <th>Поставщик</th>
                <th className="col-num">Долг на начало</th>
                <th className="col-num">Приход</th>
                <th className="col-num">Оплата</th>
                <th className="col-num">Долг на конец</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="col-num">{formatMoney(row.opening_debt)}</td>
                  <td className="col-num">{formatMoney(row.prihod)}</td>
                  <td className="col-num">{formatMoney(row.payment)}</td>
                  <td className="col-num"><strong>{formatMoney(row.closing_debt)}</strong></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    {loading ? 'Загрузка…' : 'Нет данных за выбранный период'}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="report-total-row supplier-debt-total-row">
                  <td><strong>Итого</strong></td>
                  <td className="col-num"><strong>{formatMoney(totals.opening_debt)}</strong></td>
                  <td className="col-num"><strong>{formatMoney(totals.prihod)}</strong></td>
                  <td className="col-num"><strong>{formatMoney(totals.payment)}</strong></td>
                  <td className="col-num debt-balance-creditors"><strong>{formatMoney(totals.closing_debt)}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function formatPct(n) {
  const value = Number(n) || 0;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`;
}

function PnlReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return todayLocalIso(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalIso());
  const { branchName, branchId } = useBranch();

  const loadReport = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api.getPnLReport(params)
      .then(setReport)
      .catch((e) => {
        setLoadError(e.message || 'Не удалось загрузить отчёт');
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadReport();
  }, [branchId, loadReport]);

  const expenseItems = (report?.operating_expenses?.items || []).filter((item) => item.source !== 'inventory');
  const incomeItems = (report?.other_income?.items || []).filter((item) => item.source !== 'inventory');
  const inventoryExpense = (report?.operating_expenses?.items || []).find((item) => item.source === 'inventory');
  const inventoryIncome = (report?.other_income?.items || []).find((item) => item.source === 'inventory');

  return (
    <div className="pnl-report-page">
      <div className="page-header">
        <div>
          <h1>P&L — прибыли и убытки</h1>
          <p className="page-subtitle">Метод начисления: выручка по проведённым расходам клиентам</p>
        </div>
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
            <button type="button" className="btn btn-primary btn-sm" onClick={loadReport} disabled={loading}>
              {loading ? 'Загрузка…' : 'Обновить'}
            </button>
          </div>
        </div>
      </div>

      {loadError && <div className="alert alert-error">{loadError}</div>}

      {report && (
        <>
          {report.notes && (
            <div className="alert">{report.notes}</div>
          )}

          <div className="opening-balance-kpi pnl-report-kpi">
            <div className="stat-card">
              <span className="label">Выручка</span>
              <span className="value">{formatMoney(report.revenue.total)}</span>
              <span className="stock-kpi-hint">
                {report.revenue.doc_count} продаж
              </span>
            </div>
            <div className="stat-card">
              <span className="label">Себестоимость</span>
              <span className="value">{formatMoney(report.cogs.total)}</span>
            </div>
            <div className="stat-card debt-kpi-debtors">
              <span className="label">Валовая прибыль</span>
              <span className="value">{formatMoney(report.gross_profit)}</span>
              <span className="stock-kpi-hint">маржа {formatPct(report.gross_margin_pct)}</span>
            </div>
            <div className="stat-card debt-kpi-creditors">
              <span className="label">Операционные расходы</span>
              <span className="value">{formatMoney(report.operating_expenses.total)}</span>
            </div>
            <div className="stat-card ob-kpi-net">
              <span className="label">Чистая прибыль</span>
              <span className="value">{formatMoney(report.net_profit)}</span>
              <span className="stock-kpi-hint">маржа {formatPct(report.net_margin_pct)}</span>
            </div>
          </div>

          <div className="card pnl-report-table-card">
            <div className="card-header">
              <strong>Структура отчёта</strong>
              <span className="report-meta">
                {formatDate(dateFrom)} — {formatDate(dateTo)}
              </span>
            </div>
            <div className="table-wrap">
              <table className="pnl-report-table">
                <tbody>
                  <tr className="pnl-section-row">
                    <td colSpan={2}><strong>Выручка</strong></td>
                  </tr>
                  <tr>
                    <td>Товары / услуги (расходные документы)</td>
                    <td className="col-num">{formatMoney(report.revenue.sales)}</td>
                  </tr>
                  {(report.revenue.dishes || 0) > 0 && (
                    <tr>
                      <td>Продажа блюд ({report.revenue.dish_doc_count || 0} док.)</td>
                      <td className="col-num">{formatMoney(report.revenue.dishes)}</td>
                    </tr>
                  )}
                  {(report.revenue.returns || 0) > 0 && (
                    <tr>
                      <td>Возвраты от клиентов</td>
                      <td className="col-num">− {formatMoney(report.revenue.returns)}</td>
                    </tr>
                  )}
                  <tr className="pnl-subtotal-row">
                    <td><strong>Итого выручка</strong></td>
                    <td className="col-num"><strong>{formatMoney(report.revenue.total)}</strong></td>
                  </tr>

                  <tr className="pnl-section-row">
                    <td colSpan={2}><strong>Себестоимость продаж</strong></td>
                  </tr>
                  <tr>
                    <td>COGS по строкам продаж</td>
                    <td className="col-num">− {formatMoney(report.cogs.total)}</td>
                  </tr>
                  <tr className="pnl-subtotal-row">
                    <td><strong>Валовая прибыль</strong></td>
                    <td className="col-num"><strong>{formatMoney(report.gross_profit)}</strong></td>
                  </tr>

                  <tr className="pnl-section-row">
                    <td colSpan={2}><strong>Операционные расходы</strong></td>
                  </tr>
                  {expenseItems.length === 0 && !inventoryExpense ? (
                    <tr>
                      <td className="text-muted">Нет расходов за период</td>
                      <td className="col-num">—</td>
                    </tr>
                  ) : expenseItems.map((item) => (
                    <tr key={`exp-${item.code || item.name}`}>
                      <td>{item.name}</td>
                      <td className="col-num">− {formatMoney(item.amount)}</td>
                    </tr>
                  ))}
                  {inventoryExpense && (
                    <tr>
                      <td>Инвентаризация (недостача)</td>
                      <td className="col-num">− {formatMoney(inventoryExpense.amount)}</td>
                    </tr>
                  )}
                  <tr className="pnl-subtotal-row">
                    <td><strong>Итого операционные расходы</strong></td>
                    <td className="col-num"><strong>− {formatMoney(report.operating_expenses.total)}</strong></td>
                  </tr>

                  <tr className="pnl-section-row">
                    <td colSpan={2}><strong>Прочие доходы</strong></td>
                  </tr>
                  {incomeItems.length === 0 && !inventoryIncome ? (
                    <tr>
                      <td className="text-muted">Нет прочих доходов</td>
                      <td className="col-num">—</td>
                    </tr>
                  ) : incomeItems.map((item) => (
                    <tr key={`inc-${item.code || item.name}`}>
                      <td>{item.name}</td>
                      <td className="col-num">{formatMoney(item.amount)}</td>
                    </tr>
                  ))}
                  {inventoryIncome && (
                    <tr>
                      <td>Инвентаризация (излишек)</td>
                      <td className="col-num">{formatMoney(inventoryIncome.amount)}</td>
                    </tr>
                  )}
                  <tr className="pnl-subtotal-row">
                    <td><strong>Итого прочие доходы</strong></td>
                    <td className="col-num"><strong>{formatMoney(report.other_income.total)}</strong></td>
                  </tr>

                  <tr className="pnl-total-row">
                    <td><strong>Чистая прибыль</strong></td>
                    <td className="col-num"><strong>{formatMoney(report.net_profit)}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="pnl-report-footnote">
              Закуп товара и оплаты поставщикам в P&L не входят — это движение запасов.
              Операционные расходы берутся из кассы (статьи кроме «Закуп»).
              Недостача инвентаризации — прочий расход без кассы; излишек — прочий доход.
            </p>
          </div>

          {(report.by_category?.length > 0 || report.by_month?.length > 0) && (
            <div className="pnl-report-breakdown">
              {report.by_category?.length > 0 && (
                <div className="card pnl-report-table-card">
                  <div className="card-header"><strong>По категориям</strong></div>
                  <div className="table-wrap">
                    <table className="pnl-report-table">
                      <thead>
                        <tr>
                          <th>Категория</th>
                          <th className="col-num">Выручка</th>
                          <th className="col-num">COGS</th>
                          <th className="col-num">Валовая</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.by_category.map((row) => (
                          <tr key={row.category_id || row.category_name}>
                            <td>{row.category_name}</td>
                            <td className="col-num">{formatMoney(row.revenue)}</td>
                            <td className="col-num">{formatMoney(row.cogs)}</td>
                            <td className="col-num"><strong>{formatMoney(row.gross_profit)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {report.by_month?.length > 0 && (
                <div className="card pnl-report-table-card">
                  <div className="card-header"><strong>По месяцам</strong></div>
                  <div className="table-wrap">
                    <table className="pnl-report-table">
                      <thead>
                        <tr>
                          <th>Месяц</th>
                          <th className="col-num">Выручка</th>
                          <th className="col-num">COGS</th>
                          <th className="col-num">Валовая</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.by_month.map((row) => (
                          <tr key={row.month}>
                            <td>{row.month}</td>
                            <td className="col-num">{formatMoney(row.revenue)}</td>
                            <td className="col-num">{formatMoney(row.cogs)}</td>
                            <td className="col-num"><strong>{formatMoney(row.gross_profit)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DebtsReportShell() {
  const { branchName } = useBranch();

  return (
    <div className="debts-report-shell">
      <div className="stock-report-top">
        <div className="stock-report-head debts-report-head">
          <h1>Задолженности</h1>
          <BranchChip className="stock-location-chip">{branchName}</BranchChip>
        </div>
        <nav className="debt-kind-tabs" aria-label="Тип задолженности">
          <NavLink
            to="/reports/debts/debtors"
            end
            className={({ isActive }) => `debt-kind-tab debt-kind-tab-debtors${isActive ? ' active' : ''}`}
          >
            Дебиторы
          </NavLink>
          <NavLink
            to="/reports/debts/creditors"
            end
            className={({ isActive }) => `debt-kind-tab debt-kind-tab-creditors${isActive ? ' active' : ''}`}
          >
            Кредиторы
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}

function CashArticlesReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return todayLocalIso(d);
  });
  const [dateTo, setDateTo] = useState(() => todayLocalIso());
  const { branchName, branchId } = useBranch();

  const loadReport = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api.getCashArticlesReport(params)
      .then(setReport)
      .catch((e) => {
        setLoadError(e.message || 'Не удалось загрузить отчёт');
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadReport();
  }, [branchId, loadReport]);

  const incomeItems = report?.income?.items || [];
  const expenseItems = report?.expense?.items || [];

  const renderTable = (title, items, total, opsCount, emptyText) => (
    <div className="card pnl-report-table-card">
      <div className="card-header">
        <strong>{title}</strong>
        <span className="text-muted" style={{ marginLeft: 8 }}>
          {opsCount || 0} опер. · {formatMoney(total || 0)}
        </span>
      </div>
      <div className="table-wrap">
        <table className="pnl-report-table">
          <thead>
            <tr>
              <th>Статья</th>
              <th className="col-num">Операций</th>
              <th className="col-num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty">{emptyText}</td>
              </tr>
            ) : items.map((item) => (
              <tr key={`${item.direction}-${item.article_id || item.code || item.name}`}>
                <td>{item.name}</td>
                <td className="col-num">{item.ops_count}</td>
                <td className="col-num">{formatMoney(item.amount)}</td>
              </tr>
            ))}
            {items.length > 0 && (
              <tr className="pnl-subtotal-row">
                <td><strong>Итого</strong></td>
                <td className="col-num"><strong>{opsCount}</strong></td>
                <td className="col-num"><strong>{formatMoney(total)}</strong></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="pnl-report-page">
      <div className="page-header">
        <div>
          <h1>Отчёт по статьям</h1>
          <p className="page-subtitle">
            Обороты кассы и банка по статьям только этого филиала ({branchName})
          </p>
        </div>
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
            <button type="button" className="btn btn-primary btn-sm" onClick={loadReport} disabled={loading}>
              {loading ? 'Загрузка…' : 'Обновить'}
            </button>
          </div>
        </div>
      </div>

      {loadError && <div className="alert alert-error">{loadError}</div>}

      {report && (
        <div className="pnl-report-breakdown" style={{ display: 'grid', gap: 16 }}>
          {renderTable(
            'Приход по статьям',
            incomeItems,
            report.income.total,
            report.income.ops_count,
            'Нет приходов со статьями за период',
          )}
          {renderTable(
            'Расход по статьям',
            expenseItems,
            report.expense.total,
            report.expense.ops_count,
            'Нет расходов со статьями за период',
          )}
        </div>
      )}
    </div>
  );
}

export default function Reports() {
  return (
    <Routes>
      <Route index element={<Navigate to="stock" replace />} />
      <Route path="stock" element={<StockReport />} />
      <Route path="movement" element={<StockMovementReport />} />
      <Route path="documents" element={<DocumentsReport />} />
      <Route path="debts" element={<DebtsReportShell />}>
        <Route index element={<Navigate to="debtors" replace />} />
        <Route path="debtors" element={<CounterpartyDebtReport kind="debtors" />} />
        <Route path="creditors" element={<CounterpartyDebtReport kind="creditors" />} />
        <Route path="*" element={<Navigate to="/reports/debts/debtors" replace />} />
      </Route>
      <Route path="debtors" element={<Navigate to="/reports/debts/debtors" replace />} />
      <Route path="creditors" element={<Navigate to="/reports/debts/creditors" replace />} />
      <Route path="reconciliation" element={<ReconciliationReport />} />
      <Route path="supplier-debts" element={<SupplierDebtMovementReport />} />
      <Route path="pnl" element={<PnlReport />} />
      <Route path="cash-articles" element={<CashArticlesReport />} />
      <Route path="returns" element={<SupplierReturnsReport />} />
    </Routes>
  );
}
