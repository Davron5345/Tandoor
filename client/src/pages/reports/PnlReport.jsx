import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatMoney } from '../../api';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import { todayLocalIso } from '../../utils/date';

function formatPct(n) {
  const value = Number(n) || 0;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`;
}

export function PnlReport() {
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
