import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import PublicShop from './pages/PublicShop';
import ShopOrdersMobile from './pages/ShopOrdersMobile';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { BranchProvider } from './BranchContext';
import AppUpdateManager from './components/AppUpdateManager';
import RootEntry from './RootEntry';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AppUpdateManager />
        <Routes>
          <Route path="/shop/:branchId/dept/:departmentId" element={<PublicShop />} />
          <Route path="/shop/:branchId" element={<PublicShop />} />
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
          <Route path="/*" element={<RootEntry />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
