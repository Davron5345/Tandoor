import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PublicShop from './pages/PublicShop';
import EmployeeLogin from './pages/EmployeeLogin';
import EmployeeCabinet from './pages/EmployeeCabinet';
import ShopOrdersMobile from './pages/ShopOrdersMobile';
import PrihodMobile from './pages/PrihodMobile';
import TransferMobile from './pages/TransferMobile';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { BranchProvider } from './BranchContext';
import AppUpdateManager from './components/AppUpdateManager';
import ErrorBoundary from './components/ErrorBoundary';
import RootEntry from './RootEntry';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AppUpdateManager />
          <Routes>
            <Route path="/shop/:branchId/dept/:departmentId" element={<PublicShop />} />
            <Route path="/shop/:branchId" element={<PublicShop />} />
            <Route path="/e/:token" element={<EmployeeLogin />} />
            <Route path="/s/:token" element={<EmployeeCabinet />} />
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
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
