import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, formatMoney } from '../../api';
import { useBranch } from '../../BranchContext';
import BranchChip from '../../components/BranchChip';
import { useToast } from '../../components/Modal';
import { todayLocalIso } from '../../utils/date';
import { downloadSupplierDebtReport } from '../../utils/supplierDebtExport';
import {
  deleteSupplierDebtTemplate,
  getLastSupplierDebtTemplateId,
  listSupplierDebtTemplates,
  saveSupplierDebtTemplate,
  setLastSupplierDebtTemplateId,
} from '../../utils/supplierDebtTemplates';
import ReportSupplierMultiSelect from '../../components/ReportSupplierMultiSelect';

function sameIdSet(a = [], b = []) {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map(String));
  return a.every((id) => setB.has(String(id)));
}

export function SupplierDebtMovementReport() {
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
