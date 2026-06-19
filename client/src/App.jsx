import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import { useEffect, useState, useCallback, useRef } from 'react';
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
import AuditLog from './pages/AuditLog';
import Razdelka from './pages/Razdelka';
import Calculations from './pages/Calculations';
import Reports from './pages/Reports';
import MyShop from './pages/MyShop';
import MyShopConstructor from './pages/MyShopConstructor';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import { api } from './api';
import { useTheme } from './ThemeContext';
import { useAuth } from './AuthContext';
import { useBranch } from './BranchContext';
import { hasPermission, hasAnyPermission } from './permissions';
import {
  IconNavHome,
  IconNavDocuments,
  IconNavCatalog,
  IconNavShop,
  IconNavReports,
  IconNavCashier,
  IconNavPayments,
  IconNavArticles,
  IconNavTelegram,
  IconNavAdmin,
  IconNavWarehouse,
  IconNavSun,
  IconNavMoon,
  IconNavChevronLeft,
  IconNavChevronRight,
  IconNavChevronDown,
  IconNavMenu,
  IconNavLogout,
  IconNavBranch,
} from './components/NavIcons';

const SIDEBAR_COLLAPSED_KEY = 'warehouse-sidebar-collapsed';

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function pathInGroup(pathname, paths) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NavItemContent({ icon: Icon, label }) {
  return (
    <>
      <span className="nav-icon">{Icon ? <Icon /> : null}</span>
      <span className="nav-label">{label}</span>
    </>
  );
}

function NavGroup({
  groupId,
  icon: Icon,
  label,
  children,
  paths,
  isOpen,
  onToggle,
  sidebarCollapsed,
  flyoutOpen,
  onFlyoutToggle,
  onFlyoutClose,
}) {
  const location = useLocation();
  const isActive = pathInGroup(location.pathname, paths);
  const [flyoutPos, setFlyoutPos] = useState({ top: 0, left: 0 });
  const groupRef = useRef(null);
  const toggleRef = useRef(null);
  const flyoutRef = useRef(null);
  const itemsVisible = sidebarCollapsed ? flyoutOpen : isOpen;

  const syncFlyoutPosition = useCallback(() => {
    const el = toggleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxTop = Math.max(8, window.innerHeight - 360);
    setFlyoutPos({
      top: Math.min(Math.max(8, rect.top), maxTop),
      left: rect.right + 8,
    });
  }, []);

  useEffect(() => {
    if (!flyoutOpen || !sidebarCollapsed) return undefined;

    syncFlyoutPosition();
    const onLayout = () => syncFlyoutPosition();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);

    const closeFlyout = (event) => {
      const target = event.target;
      if (toggleRef.current?.contains(target)) return;
      if (flyoutRef.current?.contains(target)) return;
      if (groupRef.current?.contains(target)) return;
      onFlyoutClose();
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('click', closeFlyout);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', closeFlyout);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [flyoutOpen, sidebarCollapsed, syncFlyoutPosition, onFlyoutClose]);

  const handleToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (sidebarCollapsed) {
      if (!flyoutOpen) window.requestAnimationFrame(syncFlyoutPosition);
      onFlyoutToggle();
      return;
    }
    onToggle(groupId);
  };

  const flyoutStyle = sidebarCollapsed && flyoutOpen
    ? { top: flyoutPos.top, left: flyoutPos.left }
    : undefined;

  return (
    <div
      ref={groupRef}
      className={[
        'nav-group',
        isActive ? 'nav-group-active' : '',
        isOpen ? 'nav-group-open' : '',
        flyoutOpen ? 'nav-group-flyout-open' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        ref={toggleRef}
        type="button"
        className="nav-group-toggle"
        onClick={handleToggle}
        aria-expanded={itemsVisible}
        title={sidebarCollapsed ? label : undefined}
      >
        <span className="nav-group-toggle-main">
          <span className="nav-icon">{Icon ? <Icon /> : null}</span>
          <span className="nav-label">{label}</span>
        </span>
        <span className={`nav-group-chevron${isOpen ? ' is-open' : ''}`} aria-hidden="true">
          <IconNavChevronDown />
        </span>
      </button>
      <div
        ref={flyoutRef}
        className={`nav-group-items${itemsVisible ? ' is-visible' : ''}${sidebarCollapsed ? ' nav-flyout-panel' : ''}`}
        style={flyoutStyle}
      >
        {sidebarCollapsed && <div className="nav-flyout-title">{label}</div>}
        {children}
      </div>
    </div>
  );
}

function AppContent() {
  const [telegramOnline, setTelegramOnline] = useState(false);
  const [openNavGroup, setOpenNavGroup] = useState(null);
  const [openFlyoutGroup, setOpenFlyoutGroup] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
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
    if (!sidebarCollapsed) setOpenFlyoutGroup(null);
  }, [sidebarCollapsed]);

  useEffect(() => {
    setOpenFlyoutGroup(null);
  }, [location.pathname]);

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
      ...(canViewDocumentsLocal ? ['/documents'] : []),
      ...(hasPermission(user, 'reports.view') ? ['/reports/stock', '/reports/documents', '/reports/debts', '/reports/reconciliation', '/reports/returns'] : []),
    ];

    const docPathsLocal = [
      ...docNavLocal.map((item) => item.to),
    ];

    const staffPathsLocal = [
      ...(canViewUsersLocal ? ['/employees'] : []),
      ...(isAdminUser ? ['/roles', '/branches', '/departments', '/audit-log'] : []),
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

  if (user.must_change_password) {
    return <ChangePassword />;
  }

  const isAdmin = user.role === 'admin';
  const canViewUsers = hasPermission(user, 'users.view');
  const showStaffGroup = canViewUsers || isAdmin;

  const canViewProducts = hasPermission(user, 'products.view');

  const canViewDocuments = hasPermission(user, 'documents.view');
  const canViewPayments = hasPermission(user, 'payments.view');
  const canViewCashier = hasAnyPermission(user, ['cashier.view', 'cashier.edit', 'payments.view', 'payments.edit']);
  const canViewCashArticles = hasPermission(user, 'cash_articles.view');
  const canViewCounterparties = hasPermission(user, 'counterparties.view');
  const canViewTelegram = hasPermission(user, 'telegram.view');
  const canViewDashboard = hasPermission(user, 'dashboard.view');
  const canEditProducts = hasPermission(user, 'products.edit');
  const isMyShopStore = location.pathname === '/myshop';
  const isMyShopConstructor = location.pathname === '/myshop/constructor';

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
    ...(canViewDocuments ? [{ to: '/documents', label: 'Журнал документов', perm: 'documents.view' }] : []),
    { to: '/reports/stock', label: 'Остатки на складе', perm: 'reports.view' },
    { to: '/reports/documents', label: 'Документы за период', perm: 'reports.view' },
    { to: '/reports/debts/debtors', label: 'Задолженности', perm: 'reports.view' },
    { to: '/reports/reconciliation', label: 'Акт сверки', perm: 'reports.view' },
    { to: '/reports/returns', label: 'Возвраты поставщикам', perm: 'reports.view' },
  ].filter((item) => hasPermission(user, item.perm));

  const reportPaths = reportNav.map((item) => item.to);

  const docPaths = docNav.map((item) => item.to);

  const showDocumentsGroup = docPaths.length > 0;

  const staffPaths = [
    ...(canViewUsers ? ['/employees'] : []),
    ...(isAdmin ? ['/roles', '/branches', '/departments', '/audit-log'] : []),
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

  const toggleFlyoutGroup = (groupId) => {
    setOpenFlyoutGroup((current) => (current === groupId ? null : groupId));
  };

  const closeFlyoutGroup = () => {
    setOpenFlyoutGroup(null);
  };

  const navGroupFlyoutProps = (groupId) => ({
    flyoutOpen: openFlyoutGroup === groupId,
    onFlyoutToggle: () => toggleFlyoutGroup(groupId),
    onFlyoutClose: closeFlyoutGroup,
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}${isMyShopStore ? ' app-myshop-mode' : ''}${isMyShopConstructor ? ' app-myshop-constructor-mode' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-panel">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-mark" aria-hidden><IconNavWarehouse /></div>
            <div className="logo-text">
              <strong>Склад</strong>
              <span>Учёт прихода и расхода</span>
            </div>
          </div>
          <div className="sidebar-header-actions">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
              aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
            >
              {sidebarCollapsed ? <IconNavChevronRight /> : <IconNavChevronLeft />}
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
            </button>
          </div>
        </div>
        <div className="sidebar-body">
          <nav className="nav">
            {canViewDashboard && (
              <NavLink
                to="/"
                end
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? 'Главная' : undefined}
              >
                <NavItemContent icon={IconNavHome} label="Главная" />
              </NavLink>
            )}

            {canViewProducts && (
              <NavLink
                to="/myshop"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? 'MyShop' : undefined}
              >
                <NavItemContent icon={IconNavShop} label="MyShop" />
              </NavLink>
            )}

            {canEditProducts && (
              <NavLink
                to="/myshop/constructor"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? 'Конструктор MyShop' : undefined}
              >
                <NavItemContent icon={IconNavCatalog} label="Конструктор MyShop" />
              </NavLink>
            )}

            {showDocumentsGroup && (
              <NavGroup
                groupId="documents"
                icon={IconNavDocuments}
                label="Документы"
                paths={docPaths}
                isOpen={openNavGroup === 'documents'}
                onToggle={toggleNavGroup}
                sidebarCollapsed={sidebarCollapsed}
                {...navGroupFlyoutProps('documents')}
              >
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
                icon={IconNavCatalog}
                label="Справочники"
                paths={catalogPaths}
                isOpen={openNavGroup === 'catalog'}
                onToggle={toggleNavGroup}
                sidebarCollapsed={sidebarCollapsed}
                {...navGroupFlyoutProps('catalog')}
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
                icon={IconNavReports}
                label="Отчёты"
                paths={reportPaths}
                isOpen={openNavGroup === 'reports'}
                onToggle={toggleNavGroup}
                sidebarCollapsed={sidebarCollapsed}
                {...navGroupFlyoutProps('reports')}
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
                title={sidebarCollapsed ? 'Касса' : undefined}
              >
                <NavItemContent icon={IconNavCashier} label="Касса" />
              </NavLink>
            )}

            {canViewPayments && (
              <NavLink
                to="/payments"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? 'Оплаты' : undefined}
              >
                <NavItemContent icon={IconNavPayments} label="Оплаты" />
              </NavLink>
            )}

            {canViewCashArticles && (
              <NavLink
                to="/cash-articles"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? 'Статьи кассы' : undefined}
              >
                <NavItemContent icon={IconNavArticles} label="Статьи кассы" />
              </NavLink>
            )}

            {canViewTelegram && (
              <NavLink
                to="/telegram"
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                title={sidebarCollapsed ? 'Telegram' : undefined}
              >
                <NavItemContent icon={IconNavTelegram} label="Telegram" />
              </NavLink>
            )}

            {showStaffGroup && (
              <NavGroup
                groupId="admin"
                icon={IconNavAdmin}
                label="Администрирование"
                paths={staffPaths}
                isOpen={openNavGroup === 'admin'}
                onToggle={toggleNavGroup}
                sidebarCollapsed={sidebarCollapsed}
                {...navGroupFlyoutProps('admin')}
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
                {isAdmin && (
                  <NavLink
                    to="/audit-log"
                    className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                  >
                    Журнал аудита
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
            <div className="sidebar-branch-name">
              <IconNavBranch />
              <span>{branchName}</span>
            </div>
          )}
          <div className="sidebar-profile">
            <div className="sidebar-profile-avatar" aria-hidden>
              {(user.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="sidebar-profile-meta">
              <span className="sidebar-user-name">{user.name}</span>
              {user.roleLabel !== user.name && (
                <span className="sidebar-user-role">{user.roleLabel}</span>
              )}
            </div>
            <button
              type="button"
              className="sidebar-logout-btn"
              onClick={logout}
              title="Выйти"
              aria-label="Выйти"
            >
              <IconNavLogout />
            </button>
          </div>
          {hasPermission(user, 'telegram.view') && (
            <div className={`telegram-badge ${telegramOnline ? 'online' : 'offline'}`}>
              <span className="telegram-badge-dot" aria-hidden="true" />
              <span>{telegramOnline ? 'Telegram бот активен' : 'Telegram не настроен'}</span>
            </div>
          )}
        </div>
        </div>
      </aside>

      <main className="main">
        <div className="main-topbar">
          <button
            type="button"
            className="sidebar-menu-btn"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Показать меню' : 'Скрыть меню'}
            aria-label={sidebarCollapsed ? 'Показать меню' : 'Скрыть меню'}
            aria-expanded={!sidebarCollapsed}
          >
            <IconNavMenu />
            <span>{sidebarCollapsed ? 'Меню' : 'Свернуть'}</span>
          </button>
        </div>
        <div className="main-content">
        <Routes key={branchId || 'default'}>
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
          <Route path="/myshop/constructor" element={canEditProducts ? <MyShopConstructor /> : <Navigate to="/myshop" />} />
          <Route path="/myshop" element={canViewProducts ? <MyShop /> : <Navigate to="/" />} />
          <Route path="/products" element={canViewProducts ? <Products /> : <Navigate to="/" />} />
          <Route path="/product-categories" element={canViewProducts ? <ProductCategories /> : <Navigate to="/" />} />
          <Route path="/counterparties" element={hasPermission(user, 'counterparties.view') ? <Counterparties /> : <Navigate to="/" />} />
          <Route path="/telegram" element={hasPermission(user, 'telegram.view') ? <TelegramPage onStatusChange={refreshTelegramStatus} /> : <Navigate to="/" />} />
          <Route path="/employees" element={canViewUsers ? <Employees /> : <Navigate to={firstNavPath} />} />
          <Route path="/roles" element={isAdmin ? <Roles /> : <Navigate to={firstNavPath} />} />
          <Route path="/branches" element={isAdmin ? <Branches /> : <Navigate to={firstNavPath} />} />
          <Route path="/departments" element={isAdmin ? <Departments /> : <Navigate to={firstNavPath} />} />
          <Route path="/audit-log" element={isAdmin ? <AuditLog /> : <Navigate to={firstNavPath} />} />
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
