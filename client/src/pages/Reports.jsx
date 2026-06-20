import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { api, formatDate, formatMoney } from '../api';
import { DOC_TYPE_LABELS } from '../permissions';
import { useBranch } from '../BranchContext';
import BranchChip from '../components/BranchChip';
import { todayLocalIso } from '../utils/date';

function formatQty(n) {
  const value = Number(n) || 0;
  if (Number.isInteger(value)) return String(value);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
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

function StockTableColgroup({ showDepartmentColumn }) {
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
    </colgroup>
  );
}

function StockTableHeadRow({ showDepartmentColumn, sortKey, sortDir, onSort }) {
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
        label="Себестоимость"
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
  const tableWrapRef = useRef(null);
  const theadRef = useRef(null);
  const { branchName, branchId } = useBranch();

  useEffect(() => {
    api.getDepartments({ active: '1' }).then(setDepartments).catch(console.error);
  }, [branchId]);

  useEffect(() => {
    const params = { only_in_stock: onlyInStock ? '1' : '0' };
    if (departmentId) params.department_id = departmentId;
    api.getStockReport(params).then(setRows).catch(console.error);
  }, [branchId, departmentId, onlyInStock]);

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
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (categoryId && row.category_id !== categoryId) return false;
      if (!q) return true;
      const haystack = [
        row.name,
        row.category_name,
        row.department_name,
        row.unit,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
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
  const colCount = showDepartmentColumn ? 8 : 7;

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
              <StockTableColgroup showDepartmentColumn={showDepartmentColumn} />
              <thead>
                <StockTableHeadRow
                  showDepartmentColumn={showDepartmentColumn}
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
            <StockTableColgroup showDepartmentColumn={showDepartmentColumn} />
            <thead ref={theadRef}>
              <StockTableHeadRow
                showDepartmentColumn={showDepartmentColumn}
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
                  <td className="product-name">{row.name}</td>
                  <td className="category-cell">{row.category_name || '—'}</td>
                  <td className="col-unit">{row.unit}</td>
                  <td className="col-num">{formatQty(row.stock)}</td>
                  <td className="col-num muted">{formatMoney(row.unitCost)}</td>
                  <td className="col-num strong">{formatMoney(row.total)}</td>
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
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
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
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => [r.name, r.phone, r.email].some((v) => (v || '').toLowerCase().includes(q)));
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
                    <strong>{row.name}</strong>
                  </td>
                  <td className="debt-contact-cell">
                    {row.phone && <span>{row.phone}</span>}
                    {row.email && <span className="debt-email">{row.email}</span>}
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
  const [counterparties, setCounterparties] = useState([]);
  const [counterpartyId, setCounterpartyId] = useState('');
  const [documents, setDocuments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [cpOpeningBalance, setCpOpeningBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
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

  const load = useCallback(() => {
    if (!counterpartyId) {
      setDocuments([]);
      setPayments([]);
      setLoadError('');
      return;
    }
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.getDocuments({ status: 'confirmed', date_from: dateFrom, date_to: dateTo }),
      api.getPayments(),
    ])
      .then(([docs, pays]) => {
        setDocuments(docs.filter((d) => (
          d.counterparty_id === counterpartyId
          && (!dateFrom || d.date >= dateFrom)
          && (!dateTo || d.date <= dateTo)
        )));
        setPayments(pays.filter((p) => (
          p.counterparty_id === counterpartyId
          && (!dateFrom || p.date >= dateFrom)
          && (!dateTo || p.date <= dateTo)
        )));
      })
      .catch((e) => {
        setLoadError(e.message || 'Не удалось загрузить акт сверки');
        setDocuments([]);
        setPayments([]);
      })
      .finally(() => setLoading(false));
  }, [counterpartyId, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [branchId, load]);

  useEffect(() => {
    if (!counterpartyId || !selectedCounterparty) {
      setCpOpeningBalance(0);
      return;
    }
    const fetcher = selectedCounterparty.type === 'supplier'
      ? api.getCreditorsReport({ include_zero: '1' })
      : api.getDebtorsReport({ include_zero: '1' });
    fetcher
      .then((report) => {
        const row = (report.rows || []).find((r) => r.id === counterpartyId);
        setCpOpeningBalance(row?.opening_balance || 0);
      })
      .catch(() => setCpOpeningBalance(0));
  }, [counterpartyId, selectedCounterparty, branchId]);

  const rows = useMemo(() => {
    if (!selectedCounterparty) return [];
    const isSupplier = selectedCounterparty.type === 'supplier';
    const docRows = documents
      .map((d) => {
        if (isSupplier && d.type === 'prihod') {
          return {
            date: d.date,
            ref: `Документ №${d.number}`,
            operation: 'Приход',
            debit: d.total_amount || 0,
            credit: 0,
          };
        }
        if (isSupplier && d.type === 'return_supplier') {
          return {
            date: d.date,
            ref: `Документ №${d.number}`,
            operation: 'Возврат поставщику',
            debit: 0,
            credit: d.total_amount || 0,
          };
        }
        if (!isSupplier && d.type === 'rashod') {
          return {
            date: d.date,
            ref: `Документ №${d.number}`,
            operation: 'Расход клиенту',
            debit: d.total_amount || 0,
            credit: 0,
          };
        }
        return null;
      })
      .filter(Boolean);

    const payRows = payments
      .map((p) => {
        if (isSupplier && p.type !== 'supplier_payment') return null;
        if (!isSupplier && p.type !== 'customer_income') return null;
        return {
          date: p.date,
          ref: `Оплата №${p.number}`,
          operation: isSupplier ? 'Оплата поставщику' : 'Оплата от клиента',
          debit: 0,
          credit: p.amount || 0,
        };
      })
      .filter(Boolean);

    const merged = [...docRows, ...payRows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    const opening = Number(cpOpeningBalance) || 0;
    if (Math.abs(opening) > 0.005) {
      merged.unshift({
        date: '',
        ref: 'Начальное сальдо',
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
  }, [documents, payments, selectedCounterparty, cpOpeningBalance]);

  const totals = useMemo(() => {
    const debit = rows.reduce((s, r) => s + (r.debit || 0), 0);
    const credit = rows.reduce((s, r) => s + (r.credit || 0), 0);
    return { debit, credit, balance: debit - credit };
  }, [rows]);

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
              <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
                <option value="">— выберите —</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.type === 'supplier' ? 'поставщик' : 'клиент'})
                  </option>
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
                  {rows.map((r, idx) => (
                    <tr key={`${r.ref}-${idx}`}>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.ref}</td>
                      <td>{r.operation}</td>
                      <td>{formatMoney(r.debit)}</td>
                      <td>{formatMoney(r.credit)}</td>
                      <td><strong>{formatMoney(r.balance)}</strong></td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="empty">{loading ? 'Загрузка…' : 'Нет операций за период'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
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

  const expenseItems = report?.operating_expenses?.items || [];
  const incomeItems = report?.other_income?.items || [];

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
                  {expenseItems.length === 0 ? (
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
                  <tr className="pnl-subtotal-row">
                    <td><strong>Итого операционные расходы</strong></td>
                    <td className="col-num"><strong>− {formatMoney(report.operating_expenses.total)}</strong></td>
                  </tr>

                  <tr className="pnl-section-row">
                    <td colSpan={2}><strong>Прочие доходы</strong></td>
                  </tr>
                  {incomeItems.length === 0 ? (
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

export default function Reports() {
  return (
    <Routes>
      <Route index element={<Navigate to="stock" replace />} />
      <Route path="stock" element={<StockReport />} />
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
      <Route path="pnl" element={<PnlReport />} />
      <Route path="returns" element={<SupplierReturnsReport />} />
    </Routes>
  );
}
