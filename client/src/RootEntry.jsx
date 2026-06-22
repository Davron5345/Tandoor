import { Navigate } from 'react-router-dom';
import { isNativeApp } from './utils/nativeApp';
import App from './App';
import { AuthProvider } from './AuthContext';
import { BranchProvider } from './BranchContext';

export default function RootEntry() {
  if (isNativeApp()) {
    return <Navigate to="/warehouse/orders" replace />;
  }

  return (
    <AuthProvider>
      <BranchProvider>
        <App />
      </BranchProvider>
    </AuthProvider>
  );
}
