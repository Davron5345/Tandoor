import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazyPage } from './utils/lazyPage';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { BranchProvider } from './BranchContext';
import AppUpdateManager from './components/AppUpdateManager';
import ErrorBoundary from './components/ErrorBoundary';
import RootEntry from './RootEntry';
import './index.css';

const PublicShop = lazyPage(() => import('./pages/PublicShop'));
const EmployeeLogin = lazyPage(() => import('./pages/EmployeeLogin'));
const ShopOrdersMobile = lazyPage(() => import('./pages/ShopOrdersMobile'));
const PrihodMobile = lazyPage(() => import('./pages/PrihodMobile'));
const TransferMobile = lazyPage(() => import('./pages/TransferMobile'));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AppUpdateManager />
          <Suspense fallback={<div className="empty">Загрузка…</div>}>
          <Routes>
            <Route path="/shop/:branchId/dept/:departmentId" element={<PublicShop />} />
            <Route path="/shop/:branchId" element={<PublicShop />} />
            <Route path="/e/:token" element={<EmployeeLogin />} />
            <Route path="/s/:token" element={<EmployeeLogin />} />
            <Route path="/snab" element={<Navigate to="/warehouse/orders" replace />} />
            <Route
              path="/warehouse/orders"
              element={(
                <AuthProvider>
                  <BranchProvider>
                    <ShopOrdersMobile />
                  </BranchProvider>
                </AuthProvider>
              )}
            />
            <Route
              path="/warehouse/prihod"
              element={(
                <AuthProvider>
                  <BranchProvider>
                    <PrihodMobile />
                  </BranchProvider>
                </AuthProvider>
              )}
            />
            <Route
              path="/warehouse/transfer"
              element={(
                <AuthProvider>
                  <BranchProvider>
                    <TransferMobile />
                  </BranchProvider>
                </AuthProvider>
              )}
            />
            <Route path="/*" element={<RootEntry />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
