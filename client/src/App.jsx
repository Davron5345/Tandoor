import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import ProductCategories from './pages/ProductCategories';
import Counterparties from './pages/Counterparties';
import Documents from './pages/Documents';
import TelegramPage from './pages/Telegram';
import Payments from './pages/Payments';
import Cashier from './pages/Cashier';
import CashArticles from './pages/CashArticles';
import Employees from './pages/Employees';
import Roles from './pages/Roles';
import Branches from './pages/Branches';
import Departments from './pages/Departments';
import Razdelka from './pages/Razdelka';
import Calculations from './pages/Calculations';
import Reports from './pages/Reports';
import Login from './pages/Login';
import { api } from './api';
import { useTheme } from './ThemeContext';
import { useAuth } from './AuthContext';
import { useBranch } from './BranchContext';
import { hasPermission, hasAnyPermission } from './permissions';

function pathInGroup(pathname, paths) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NavGroup({ groupId, label, children, paths, isOpen, onToggle }) {
  const location = useLocation();
  const isActive = pathInGroup(location.pathname, paths);

  return (
    <div className={`nav-group${isActive ? ' nav-group-active' : ''}${isOpen ? ' nav-group-open' : ''}`}>
      <button
        type="button"
        className="nav-group-toggle"
        onClick={() => onToggle(groupId)}
        aria-expanded={isOpen}
      >
        <span>{label}</span>
        <span className="nav-group-chevron">{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen && (
        <div className="nav-group-items">
          {children}
        </div>
      )}
    </div>
  );
}

function AppContent() {
  const [telegramOnline, setTelegramOnline] = useState(false);
  const [openNavGroup, setOpenNavGroup] = useState(null);
  const { theme, toggleTheme } = useTheme();
  const { user, loading, logout } = useAuth();
  const { branches, branchId, branchName, setActiveBranchId, isAdmin: isBranchAdmin } = useBranch();
  const location = useLocation();

  const refreshTelegramStatus = useCallback(() => {
    if (!hasPermission(user, 'telegram.view')) return;
    api.getTelegramStatus().then((s) => setTelegramOnline(s.enabled)).catch(() => {});
  }, [user]);

  useEffect(() => { refreshTelegramStatus(); }, [location.pathname, refreshTelegramStatus]);

  useEffect(() => {
    if (!user) return;

    const isAdminUser = user.role === 'admin';
    const canViewUsersLocal = hasPermission(user, 'users.view');
    const canViewProductsLocal = hasPermission(user, 'products.view');
    const canViewDocumentsLocal = hasPermission(user, 'documents.view');

    const docNavLocal = [
      { to: '/prihod', perm: 'documents.prihod' },
      { to: '/transfer', perm: 'documents.transfer' },
      { to: '/razdelka', perm: 'documents.razdelka' },
      { to: '/calculations', perm: 'calculations.view' },
    ].filter((item) => hasPermission(user, item.perm));

    const catalogPathsLocal = [
      ...(canViewProductsLocal ? ['/products', '/product-categories'] : []),
      ...(hasPermission(user, 'counterparties.view') ? ['/counterparties'] : []),
    ];

    const reportPathsLocal = [
      ...(hasPermission(user, 'reports.view') ? ['/reports/stock', '/reports/documents', '/reports/debts', '/reports/reconciliation', '/reports/returns'] : []),
    ];

    const docPathsLocal = [
      ...(canViewDocumentsLocal ? ['/documents'] : []),
      ...docNavLocal.map((item) => item.to),
    ];

    const staffPathsLocal = [
      ...(canViewUsersLocal ? ['/employees'] : []),
      ...(isAdminUser ? ['/roles', '/branches', '/departments'] : []),
    ];

    const path = location.pathname;
    if (docPathsLocal.length && pathInGroup(path, docPathsLocal)) {
      setOpenNavGroup('documents');
    } else if (catalogPathsLocal.length && pathInGroup(path, catalogPathsLocal)) {
      setOpenNavGroup('catalog');
    } else if (reportPathsLocal.length && pathInGroup(path, reportPathsLocal)) {
      setOpenNavGroup('reports');
    } else if ((canViewUsersLocal || isAdminUser) && pathInGroup(path, staffPathsLocal)) {
      setOpenNavGroup('admin');
    }
  }, [user, location.pathname]);

  if (loading) {
    return <div className="login-page"><div className="empty">Загрузка...</div></div>;
  }

  if (!user) {
    return <Login />;
  }

  const isAdmin = user.role === 'admin';
  const canViewUsers = hasPermission(user, 'users.view');
  const showStaffGroup = canViewUsers || isAdmin;

  const canViewProducts = hasPermission(user, 'products.view');

  const canViewDocuments = hasPermission(user, 'documents.view');
  const canViewPayments = hasPermission(user, 'payments.view');
  const canEditPayments = hasPermission(user, 'payments.edit');
  const canViewCashier = hasAnyPermission(user, ['cashier.view', 'cashier.edit', 'payments.view', 'payments.edit']);
  const canViewCashArticles = hasPermission(user, 'cash_articles.view');
  const canViewCounterparties = hasPermission(user, 'counterparties.view');
  const canViewTelegram = hasPermission(user, 'telegram.view');
  const canViewDashboard = hasPermission(user, 'dashboard.view');

  const docNav = [
    { to: '/prihod', label: 'Приход', perm: 'documents.prihod' },
    { to: '/return-supplier', label: 'Возврат поставщику', perm: 'documents.rashod' },
    { to: '/transfer', label: 'Перемещение', perm: 'documents.transfer' },
    { to: '/razdelka', label: 'Разделка', perm: 'documents.razdelka' },
    { to: '/calculations', label: 'Калькуляции', perm: 'calculations.view' },
  ].filter((item) => hasPermission(user, item.perm));

  const catalogPaths = [
    ...(canViewProducts ? ['/products', '/product-categories'] : []),
    ...(canViewCounterparties ? ['/counterparties'] : []),
  ];

  const reportNav = [
    { to: '/reports/stock', label: 'Остатки на складе', perm: 'reports.view' },
    { to: '/reports/documents', label: 'Документы за период', perm: 'reports.view' },
    { to: '/reports/debts/debtors', label: 'Задолженности', perm: 'reports.view' },
    { to: '/reports/reconciliation', label: 'Акт сверки', perm: 'reports.view' },
    { to: '/reports/returns', label: 'Возвраты поставщикам', perm: 'reports.view' },
  ].filter((item) => hasPermission(user, item.perm));

  const reportPaths = reportNav.map((item) => item.to);

  const docPaths = [
    ...(canViewDocuments ? ['/documents'] : []),
    ...docNav.map((item) => item.to),
  ];

  const showDocumentsGroup = docPaths.length > 0;

  const staffPaths = [
    ...(canViewUsers ? ['/employees'] : []),
    ...(isAdmin ? ['/roles', '/branches', '/departments'] : []),
  ];

  const firstNavPath = ((user.role === 'cashier' && canViewCashier) ? '/cashier'
    : canViewDashboard ? '/'
    : (canViewCashier ? '/cashier' : null)
    || docPaths[0]
    || catalogPaths[0]
    || reportPaths[0]
    || (canViewPayments ? '/payments' : null)
    || staffPaths[0]
    || '/');

  const toggleNavGroup = (groupId) => {
    setOpenNavGroup((current) => (current === groupId ? null : groupId));
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-panel">
        <div className="sidebar-header">
          <div className="logo">
            📦 Склад
            <span>Учёт прихода и расхода</span>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="sidebar-body">
          <nav className="nav">
            {canViewDashboard && (
              <NavLink
                to="/"
                end
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                🏠 Главная
              </NavLink>
            )}

            {showDocumentsGroup && (
              <NavGroup
                groupId="documents"
                label="📋 Документы"
                paths={docPaths}
                isOpen={openNavGroup === 'documents'}
                onToggle={toggleNavGroup}
              >
                {canViewDocuments && (
                  <NavLink
                    to="/documents"
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    Все документы
                  </NavLink>
                )}
                {docNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </NavGroup>
            )}

            {catalogPaths.length > 0 && (
              <NavGroup
                groupId="catalog"
                label="🏷️ Справочники"
                paths={catalogPaths}
                isOpen={openNavGroup === 'catalog'}
                onToggle={toggleNavGroup}
              >
                {canViewProducts && (
                  <>
                    <NavLink
                      to="/products"
                      className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                    >
                      Товары
                    </NavLink>
                    <NavLink
                      to="/product-categories"
                      className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                    >
                      Категории
                    </NavLink>
                  </>
                )}
                {canViewCounterparties && (
                  <NavLink
                    to="/counterparties"
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    Контрагенты
                  </NavLink>
                )}
              </NavGroup>
            )}

            {reportNav.length > 0 && (
              <NavGroup
                groupId="reports"
                label="📊 Отчёты"
                paths={reportPaths}
                isOpen={openNavGroup === 'reports'}
                onToggle={toggleNavGroup}
              >
                {reportNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </NavGroup>
            )}

            {(canViewPayments || canViewTelegram || showStaffGroup) && (
              <div className="nav-divider" aria-hidden="true" />
            )}

            {canViewCashier && (
              <NavLink
                to="/cashier"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                💵 Касса
              </NavLink>
            )}

            {canViewPayments && (
              <NavLink
                to="/payments"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                💰 Оплаты
              </NavLink>
            )}

            {canViewCashArticles && (
              <NavLink
                to="/cash-articles"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                📑 Статьи кассы
              </NavLink>
            )}

            {canViewTelegram && (
              <NavLink
                to="/telegram"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                ✈️ Telegram
              </NavLink>
            )}

            {showStaffGroup && (
              <NavGroup
                groupId="admin"
                label="👤 Администрирование"
                paths={staffPaths}
                isOpen={openNavGroup === 'admin'}
                onToggle={toggleNavGroup}
              >
                {canViewUsers && (
                  <NavLink
                    to="/employees"
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    Сотрудники
                  </NavLink>
                )}
                {isAdmin && (
                  <NavLink
                    to="/roles"
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    Роли
                  </NavLink>
                )}
                {isAdmin && (
                  <NavLink
                    to="/branches"
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    Филиалы
                  </NavLink>
                )}
                {isAdmin && (
                  <NavLink
                    to="/departments"
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    Отделы
                  </NavLink>
                )}
              </NavGroup>
            )}
          </nav>
        </div>
        <div className="sidebar-footer">
          {isBranchAdmin && branches.length > 0 && (
            <div className="branch-select-wrap">
              <label className="branch-select-label">Филиал</label>
              <select
                className="branch-select"
                value={branchId || ''}
                onChange={(e) => setActiveBranchId(e.target.value)}
              >
                {branches.filter((b) => b.active).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
          {!isBranchAdmin && user.branch_id && (
            <div className="sidebar-branch-name">📍 {branchName}</div>
          )}
          <div className="sidebar-user">
            <span className="sidebar-user-name">{user.name}</span>
            {user.roleLabel !== user.name && (
              <span className="sidebar-user-role">{user.roleLabel}</span>
            )}
          </div>
          <button type="button" className="btn btn-ghost logout-btn" onClick={logout}>
            Выйти
          </button>
          {hasPermission(user, 'telegram.view') && (
            <div className={`telegram-badge ${telegramOnline ? 'online' : 'offline'}`}>
              {telegramOnline ? '🟢 Telegram бот активен' : '🟡 Telegram не настроен'}
            </div>
          )}
        </div>
        </div>
      </aside>

      <main className="main">
        <div className="main-content">
        <Routes>
          <Route path="/" element={canViewDashboard ? <Dashboard /> : <Navigate to={firstNavPath} />} />
          <Route path="/prihod" element={hasPermission(user, 'documents.prihod') ? <Documents key="prihod" defaultType="prihod" /> : <Navigate to="/" />} />
          <Route path="/rashod" element={hasPermission(user, 'documents.rashod') ? <Documents key="rashod" defaultType="rashod" /> : <Navigate to="/" />} />
          <Route path="/return-supplier" element={hasPermission(user, 'documents.rashod') ? <Documents key="return-supplier" defaultType="return_supplier" /> : <Navigate to="/" />} />
          <Route path="/transfer" element={hasPermission(user, 'documents.transfer') ? <Documents key="transfer" defaultType="peremeshchenie" /> : <Navigate to="/" />} />
          <Route path="/razdelka" element={hasPermission(user, 'documents.razdelka') ? <Razdelka /> : <Navigate to="/" />} />
          <Route path="/calculations" element={hasPermission(user, 'calculations.view') ? <Calculations /> : <Navigate to="/" />} />
          <Route path="/reports/*" element={hasPermission(user, 'reports.view') ? <Reports /> : <Navigate to="/" />} />
          <Route path="/documents" element={hasPermission(user, 'documents.view') ? <Documents /> : <Navigate to="/" />} />
          <Route path="/cashier" element={canViewCashier ? <Cashier /> : <Navigate to={firstNavPath} />} />
          <Route path="/payments" element={canViewPayments ? <Payments /> : <Navigate to="/" />} />
          <Route path="/cash-articles" element={canViewCashArticles ? <CashArticles /> : <Navigate to={firstNavPath} />} />
          <Route path="/products" element={canViewProducts ? <Products /> : <Navigate to="/" />} />
          <Route path="/product-categories" element={canViewProducts ? <ProductCategories /> : <Navigate to="/" />} />
          <Route path="/counterparties" element={hasPermission(user, 'counterparties.view') ? <Counterparties /> : <Navigate to="/" />} />
          <Route path="/telegram" element={hasPermission(user, 'telegram.view') ? <TelegramPage onStatusChange={refreshTelegramStatus} /> : <Navigate to="/" />} />
          <Route path="/employees" element={canViewUsers ? <Employees /> : <Navigate to={firstNavPath} />} />
          <Route path="/roles" element={isAdmin ? <Roles /> : <Navigate to={firstNavPath} />} />
          <Route path="/branches" element={isAdmin ? <Branches /> : <Navigate to={firstNavPath} />} />
          <Route path="/departments" element={isAdmin ? <Departments /> : <Navigate to={firstNavPath} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </div>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
