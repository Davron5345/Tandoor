import { useCallback, useEffect, useState } from 'react';
import { api, formatMoney } from '../../api';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import { todayLocalIso } from '../../utils/date';

export function CashArticlesReport() {
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
