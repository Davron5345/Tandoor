import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, formatMoney } from '../../api';
import { useAuth } from '../../AuthContext';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import { textMatchesSearch } from '../../utils/searchNormalize';
import SearchHighlight from '../../components/SearchHighlight';
import { SortHeader, formatQty } from './reportUtils';

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

export function StockReport() {
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
