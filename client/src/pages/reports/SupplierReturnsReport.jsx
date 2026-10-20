import { useCallback, useEffect, useState } from 'react';
import { api, formatDate, formatMoney } from '../../api';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import { todayLocalIso } from '../../utils/date';

export function SupplierReturnsReport() {
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
