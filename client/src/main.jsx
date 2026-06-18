import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { BranchProvider } from './BranchContext';
import { setAuthToken } from './api';
import './index.css';

const savedToken = localStorage.getItem('warehouse-auth-token');
if (savedToken) setAuthToken(savedToken);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <BranchProvider>
          <App />
        </BranchProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);