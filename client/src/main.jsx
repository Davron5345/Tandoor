import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import PublicShop from './pages/PublicShop';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { BranchProvider } from './BranchContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/shop/:branchId" element={<PublicShop />} />
          <Route
            path="*"
            element={(
              <AuthProvider>
                <BranchProvider>
                  <App />
                </BranchProvider>
              </AuthProvider>
            )}
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
