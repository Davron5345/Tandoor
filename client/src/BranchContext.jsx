import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, setActiveBranchId as setApiBranchId } from './api';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'warehouse-branch-id';
const BranchContext = createContext(null);

export function BranchProvider({ children }) {
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [activeBranchId, setActiveBranchIdState] = useState(() => localStorage.getItem(STORAGE_KEY) || '');

  const isAdmin = user?.role === 'admin';

  const loadBranches = useCallback(() => {
    if (!user) return Promise.resolve([]);
    return api.getBranches()
      .then((list) => {
        setBranches(list);
        return list;
      })
      .catch(() => []);
  }, [user]);

  useEffect(() => {
    if (!user) {
      setBranches([]);
      return;
    }
    loadBranches().then((list) => {
      if (isAdmin) {
        const saved = localStorage.getItem(STORAGE_KEY);
        const mainId = list.find((b) => b.id === 'main')?.id || list[0]?.id;
        if (saved && list.some((b) => b.id === saved)) {
          setActiveBranchIdState(saved);
        } else if (mainId) {
          setActiveBranchIdState(mainId);
          localStorage.setItem(STORAGE_KEY, mainId);
        }
      } else if (user.branch_id) {
        setActiveBranchIdState(user.branch_id);
      }
    });
  }, [user, isAdmin, loadBranches]);

  const setActiveBranchId = (id) => {
    setActiveBranchIdState(id);
    if (isAdmin) localStorage.setItem(STORAGE_KEY, id);
  };

  const activeBranch = useMemo(
    () => branches.find((b) => b.id === activeBranchId) || null,
    [branches, activeBranchId],
  );

  const branchId = isAdmin ? activeBranchId : user?.branch_id;
  const branchName = isAdmin
    ? (activeBranch?.name || 'Филиал')
    : (user?.branch_name || 'Филиал');

  useEffect(() => {
    setApiBranchId(branchId || null);
  }, [branchId]);

  return (
    <BranchContext.Provider value={{
      branches,
      branchId,
      branchName,
      activeBranchId: branchId,
      setActiveBranchId,
      isAdmin,
      reloadBranches: loadBranches,
    }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch must be used within BranchProvider');
  return ctx;
}
