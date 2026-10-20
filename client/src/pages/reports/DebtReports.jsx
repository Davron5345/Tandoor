import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api, formatDate, formatMoney } from '../../api';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import { textMatchesSearch } from '../../utils/searchNormalize';
import SearchHighlight from '../../components/SearchHighlight';

export function CounterpartyDebtReport({ kind }) {
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
                <th className="col-num" title={kind === 'debtors' ? 'Деньги, выданные клиенту (возврат, «Долг клиентам»)' : 'Деньги, вернувшиеся от поставщика'}>
                  {kind === 'debtors' ? 'Выдано' : 'Возврат денег'}
                </th>
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
                  <td className="col-num muted">{formatMoney(row.refunded || 0)}</td>
                  <td className="col-num muted">{formatMoney(row.opening_balance || 0)}</td>
                  <td className={`col-num strong debt-balance-${kind}`}>{formatMoney(row.balance)}</td>
                </tr>
              ))}
              {(loading || !report) && (
                <tr>
                  <td colSpan={8} className="empty">Загрузка…</td>
                </tr>
              )}
              {report && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty debt-report-empty">
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
                  <td colSpan={7}><strong>Итого</strong></td>
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

export function LiableDebtReport() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const { branchId } = useBranch();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError('');
    api.getLiableDebtsReport(includeZero ? { include_zero: '1' } : {})
      .then((data) => { if (alive) setReport(data); })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e.message || 'Не удалось загрузить отчёт');
        setReport({ rows: [], count: 0, total_balance: 0 });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [includeZero, branchId]);

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const rows = report?.rows || [];

  return (
    <div className="debt-report-page">
      <div className="stock-report-top">
        <div className="stock-report-kpi">
          <div className="stat-card stock-kpi-card">
            <span className="label">Должников</span>
            <span className="value">{rows.length}</span>
          </div>
          <div className="stat-card stock-kpi-card debt-kpi-total debt-kpi-debtors">
            <span className="label">Долг по инвентаризации</span>
            <span className="value">{formatMoney(report?.total_balance || 0)}</span>
          </div>
        </div>
      </div>

      <div className="card stock-report-toolbar">
        <div className="stock-toolbar-grid debt-toolbar-grid">
          <div className="stock-toolbar-actions debt-toolbar-actions">
            <label className="stock-filter-toggle">
              <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
              <span>Показывать погашенные</span>
            </label>
          </div>
        </div>
      </div>

      <div className="card debt-report-table-card">
        {loadError && <div className="alert alert-error" style={{ margin: '12px 16px 0' }}>{loadError}</div>}
        <div className="card-header debt-report-table-head">
          <strong>Сотрудники и отделы — списание непересчитанного</strong>
          <span className="report-meta">{loading ? 'Загрузка…' : `${rows.length} записей`}</span>
        </div>
        <div className="table-wrap">
          <table className="debt-report-table">
            <thead>
              <tr>
                <th className="col-index">№</th>
                <th>Должник</th>
                <th className="col-num">Начислено</th>
                <th className="col-num">Погашено</th>
                <th className="col-num">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Fragment key={row.id}>
                  <tr className="report-row-clickable" onClick={() => toggle(row.id)}>
                    <td className="col-index">{index + 1}</td>
                    <td className="debt-name-cell">
                      <strong>{expanded.has(row.id) ? '▾ ' : '▸ '}{row.name}</strong>
                      <span className="muted"> · {row.kind === 'user' ? 'сотрудник' : 'отдел'}</span>
                    </td>
                    <td className="col-num">{formatMoney(row.charged)}</td>
                    <td className="col-num muted">{formatMoney(row.repaid)}</td>
                    <td className="col-num strong debt-balance-debtors">{formatMoney(row.balance)}</td>
                  </tr>
                  {expanded.has(row.id) && row.documents.map((doc) => (
                    <tr key={`${row.id}:${doc.id}`} className="muted">
                      <td />
                      <td>
                        {formatDate(doc.date)} · списание №{doc.number}
                        {doc.parent_number ? ` (инвентаризация №${doc.parent_number})` : ''}
                        {doc.department_name ? ` · ${doc.department_name}` : ''}
                      </td>
                      <td className="col-num">{formatMoney(doc.charged)}</td>
                      <td className="col-num">{formatMoney(doc.repaid)}</td>
                      <td className="col-num">{formatMoney(doc.balance)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              {(loading || !report) && (
                <tr><td colSpan={5} className="empty">Загрузка…</td></tr>
              )}
              {report && !loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty debt-report-empty">
                    <span className="debt-empty-title">Долгов нет</span>
                    <span className="debt-empty-hint">
                      Появится после полной инвентаризации со списанием на сотрудника или отдел.
                      Погашение — касса, прочий приход «Возврат долга» с привязкой к списанию.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="report-total-row">
                  <td colSpan={4}><strong>Итого</strong></td>
                  <td className="col-num strong debt-balance-debtors">
                    <strong>{formatMoney(report?.total_balance || 0)}</strong>
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

export function DebtsReportShell() {
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
          <NavLink
            to="/reports/debts/staff"
            end
            className={({ isActive }) => `debt-kind-tab debt-kind-tab-debtors${isActive ? ' active' : ''}`}
          >
            Сотрудники
          </NavLink>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
