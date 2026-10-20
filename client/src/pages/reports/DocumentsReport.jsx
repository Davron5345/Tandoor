import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDate, formatMoney } from '../../api';
import { DOC_TYPE_LABELS } from '../../permissions';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import { todayLocalIso } from '../../utils/date';

export function DocumentsReport() {
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
