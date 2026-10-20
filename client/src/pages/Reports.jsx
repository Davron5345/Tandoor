import { Navigate, Route, Routes } from 'react-router-dom';
import { StockReport } from './reports/StockReport';
import { StockMovementReport } from './reports/StockMovementReport';
import { DocumentsReport } from './reports/DocumentsReport';
import { CounterpartyDebtReport, DebtsReportShell, LiableDebtReport } from './reports/DebtReports';
import { ReconciliationReport } from './reports/ReconciliationReport';
import { SupplierDebtMovementReport } from './reports/SupplierDebtMovementReport';
import { PnlReport } from './reports/PnlReport';
import { CashArticlesReport } from './reports/CashArticlesReport';
import { SupplierReturnsReport } from './reports/SupplierReturnsReport';

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
        <Route path="staff" element={<LiableDebtReport />} />
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
