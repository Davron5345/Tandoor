import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import { useEffect, useState, useCallback, useRef } from 'react';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import ProductCategories from './pages/ProductCategories';
import Units from './pages/Units';
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
import SecurityAdmin from './pages/SecurityAdmin';
import StaffTracking from './pages/StaffTracking';
import ErrorBoundary from './components/ErrorBoundary';
import Razdelka from './pages/Razdelka';
import DishSales from './pages/DishSales';
import Calculations from './pages/Calculations';
import Reports from './pages/Reports';
import OpeningBalance from './pages/OpeningBalance';
import MyShop from './pages/MyShop';
import MyShopConstructor from './pages/MyShopConstructor';
import ShopOrders from './pages/ShopOrders';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import { api } from './api';
import { useTheme } from './ThemeContext';
import { useAuth } from './AuthContext';
import { useBranch } from './BranchContext';
import { hasPermission, hasAnyPermission, isCashierOnlyLayout } from './permissions';
import {
  IconNavHome,
  IconNavCatalog,
  IconNavShop,
  IconNavPurchases,
  IconNavMoney,
  IconNavProduction,
  IconNavReports,
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

function filterNavItems(user, items) {
  return items.filter((item) => !item.perm || hasPermission(user, item.perm));
}

function buildAppNav(user) {
  const isAdmin = user.role === 'admin';
  const canViewProducts = hasPermission(user, 'products.view');
  const canViewCounterparties = hasPermission(user, 'counterparties.view');
  const canViewCashArticles = hasPermission(user, 'cash_articles.view');
  const canViewCashier = hasAnyPermission(user, ['cashier.view', 'cashier.edit', 'payments.view', 'payments.edit']);
  const canViewUsers = hasPermission(user, 'users.view');

  const purchasesNav = filterNavItems(user, [
    { to: '/prihod', label: 'Приход', perm: 'documents.prihod' },
    { to: '/return-supplier', label: 'Возврат поставщику', perm: 'documents.rashod' },
  ]);

  const salesNav = filterNavItems(user, [
    { to: '/dish-sales', label: 'Продажа блюд', perm: 'documents.dish_sale' },
    { to: '/return-customer', label: 'Возврат от клиента', perm: 'documents.rashod' },
    { to: '/myshop', label: 'MyShop', perm: 'myshop.view', end: true },
    { to: '/myshop/constructor', label: 'Конструктор', perm: 'myshop.edit' },
    { to: '/shop-orders', label: 'Заявки', perm: 'shop_orders.view' },
  ]);

  const catalogNav = [
    ...(canViewProducts ? [
      { to: '/products', label: 'Номенклатура' },
      { to: '/product-categories', label: 'Категории' },
      { to: '/units', label: 'Ед. измерения' },
    ] : []),
    ...(canViewCounterparties ? [{ to: '/counterparties', label: 'Контрагенты' }] : []),
    ...(canViewCashArticles ? [{ to: '/cash-articles', label: 'Статьи кассы' }] : []),
  ];

  const moneyNav = [
    ...(hasPermission(user, 'payments.view') ? [{ to: '/payments', label: 'Банк' }] : []),
    ...(canViewCashier ? [{ to: '/cashier', label: 'Окно кассира' }] : []),
  ];

  const reportsNav = filterNavItems(user, [
    { to: '/reports/stock', label: 'Остатки на складе', perm: 'reports.view' },
    { to: '/reports/documents', label: 'Документы за период', perm: 'reports.view' },
    { to: '/reports/debts/debtors', label: 'Задолженности', perm: 'reports.view' },
    { to: '/reports/reconciliation', label: 'Акт сверки', perm: 'reports.view' },
    { to: '/reports/pnl', label: 'P&L', perm: 'reports.view' },
    { to: '/opening-balance', label: 'Начальное сальдо', perm: 'opening_balance.view' },
  ]);

  const productionNav = filterNavItems(user, [
    { to: '/razdelka', label: 'Разделка', perm: 'documents.razdelka' },
    { to: '/calculations', label: 'Калькуляции', perm: 'calculations.view' },
    { to: '/transfer', label: 'Перемещение', perm: 'documents.transfer' },
  ]);

  const adminNav = [
    ...(canViewUsers ? [{ to: '/employees', label: 'Сотрудники' }] : []),
    ...(isAdmin ? [
      { to: '/tracking', label: 'Трекинг снабженцев' },
      { to: '/roles', label: 'Роли' },
      { to: '/branches', label: 'Филиалы' },
      { to: '/departments', label: 'Отделы' },
      { to: '/security', label: 'Сеансы и безопасность' },
      { to: '/audit-log', label: 'Журнал аудита' },
    ] : []),
  ];

  const sections = [
    { id: 'purchases', label: 'Закупки', icon: IconNavPurchases, items: purchasesNav },
    { id: 'sales', label: 'Продажи', icon: IconNavShop, items: salesNav },
    { id: 'catalog', label: 'Справочники', icon: IconNavCatalog, items: catalogNav },
    { id: 'money', label: 'Деньги', icon: IconNavMoney, items: moneyNav },
    { id: 'production', label: 'Производство', icon: IconNavProduction, items: productionNav },
    { id: 'reports', label: 'Отчёты', icon: IconNavReports, items: reportsNav },
    { id: 'admin', label: 'Администрирование', icon: IconNavAdmin, items: adminNav },
  ].map((section) => {
    const paths = section.items.map((item) => item.to);
    if (section.id === 'reports' && paths.some((p) => p.startsWith('/reports/debts'))) {
      paths.push('/reports/debts');
    }
    return { ...section, paths: [...new Set(paths)] };
  });

  return {
    sections,
    byId: Object.fromEntries(sections.map((section) => [section.id, section])),
  };
}

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

    const { sections } = buildAppNav(user);
    const path = location.pathname;
    const match = sections.find((section) => section.paths.length && pathInGroup(path, section.paths));
    setOpenNavGroup(match?.id ?? null);
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
  const isCashierLayout = isCashierOnlyLayout(user);
  const canViewUsers = hasPermission(user, 'users.view');
  const showStaffGroup = canViewUsers || isAdmin;
  const canViewProducts = hasPermission(user, 'products.view');
  const canViewPayments = hasPermission(user, 'payments.view');
  const canViewCashier = hasAnyPermission(user, ['cashier.view', 'cashier.edit', 'payments.view', 'payments.edit']);
  const canViewCashArticles = hasPermission(user, 'cash_articles.view');
  const canViewOpeningBalance = hasPermission(user, 'opening_balance.view');
  const canViewCounterparties = hasPermission(user, 'counterparties.view');
  const canViewTelegram = hasPermission(user, 'telegram.view');
  const canViewDashboard = hasPermission(user, 'dashboard.view');
  const canEditProducts = hasPermission(user, 'products.edit');
  const canViewMyShop = hasPermission(user, 'myshop.view');
  const canEditMyShop = hasPermission(user, 'myshop.edit');
  const canViewShopOrders = hasPermission(user, 'shop_orders.view');
  const canEditShopOrders = hasPermission(user, 'shop_orders.edit');
  const isMyShopStore = location.pathname === '/myshop';
  const isMyShopConstructor = location.pathname === '/myshop/constructor';

  const appNav = buildAppNav(user);
  const mainNavSections = appNav.sections.filter((section) => section.id !== 'admin');
  const adminSection = appNav.byId.admin;

  const firstNavPath = ((isCashierLayout && canViewCashier) ? '/cashier'
    : canViewDashboard ? '/'
    : (canViewCashier ? '/cashier' : null)
    || mainNavSections.find((section) => section.paths.length)?.paths[0]
    || adminSection.paths[0]
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
    <div className={`app${sidebarCollapsed ? ' sidebar-collapsed' : ''}${isCashierLayout ? ' app-cashier-mode' : ''}${isMyShopStore ? ' app-myshop-mode' : ''}${isMyShopConstructor ? ' app-myshop-constructor-mode' : ''}`}>
      {!isCashierLayout && (
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

            {mainNavSections.map((section) => (
              section.items.length > 0 && (
                <NavGroup
                  key={section.id}
                  groupId={section.id}
                  icon={section.icon}
                  label={section.label}
                  paths={section.paths}
                  isOpen={openNavGroup === section.id}
                  onToggle={toggleNavGroup}
                  sidebarCollapsed={sidebarCollapsed}
                  {...navGroupFlyoutProps(section.id)}
                >
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => `nav-link nav-link-sub${isActive ? ' active' : ''}`}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </NavGroup>
              )
            ))}

            {(canViewTelegram || showStaffGroup) && (
              <div className="nav-divider" aria-hidden="true" />
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

            {adminSection.items.length > 0 && (
              <NavGroup
                groupId="admin"
                icon={IconNavAdmin}
                label="Администрирование"
                paths={adminSection.paths}
                isOpen={openNavGroup === 'admin'}
                onToggle={toggleNavGroup}
                sidebarCollapsed={sidebarCollapsed}
                {...navGroupFlyoutProps('admin')}
              >
                {adminSection.items.map((item) => (
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
      )}

      <main className="main">
        {!isCashierLayout && (
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
        )}
        <div className="main-content">
        {isCashierLayout && location.pathname !== '/cashier' ? (
          <Navigate to="/cashier" replace />
        ) : (
        <Routes key={branchId || 'default'}>
          <Route path="/" element={canViewDashboard ? <Dashboard /> : <Navigate to={firstNavPath} />} />
          <Route path="/prihod" element={hasPermission(user, 'documents.prihod') ? <Documents key="prihod" defaultType="prihod" /> : <Navigate to="/" />} />
          <Route path="/rashod" element={hasPermission(user, 'documents.rashod') ? <Documents key="rashod" defaultType="rashod" /> : <Navigate to="/" />} />
          <Route path="/return-supplier" element={hasPermission(user, 'documents.rashod') ? <Documents key="return-supplier" defaultType="return_supplier" /> : <Navigate to="/" />} />
          <Route path="/return-customer" element={hasPermission(user, 'documents.rashod') ? <Documents key="return-customer" defaultType="return_customer" /> : <Navigate to="/" />} />
          <Route path="/transfer" element={hasPermission(user, 'documents.transfer') ? <Documents key="transfer" defaultType="peremeshchenie" /> : <Navigate to="/" />} />
          <Route path="/dish-sales" element={hasPermission(user, 'documents.dish_sale') ? <DishSales /> : <Navigate to="/" />} />
          <Route path="/razdelka" element={hasPermission(user, 'documents.razdelka') ? <Razdelka /> : <Navigate to="/" />} />
          <Route path="/calculations" element={hasPermission(user, 'calculations.view') ? <Calculations /> : <Navigate to="/" />} />
          <Route path="/reports/*" element={hasPermission(user, 'reports.view') ? <Reports /> : <Navigate to="/" />} />
          <Route path="/opening-balance" element={canViewOpeningBalance ? <OpeningBalance /> : <Navigate to="/" />} />
          <Route path="/documents" element={hasPermission(user, 'documents.view') ? <Documents /> : <Navigate to="/" />} />
          <Route path="/cashier" element={canViewCashier ? <Cashier /> : <Navigate to={firstNavPath} />} />
          <Route path="/payments" element={canViewPayments ? <Payments /> : <Navigate to="/" />} />
          <Route path="/cash-articles" element={canViewCashArticles ? <CashArticles /> : <Navigate to={firstNavPath} />} />
          <Route path="/myshop/constructor" element={canEditMyShop ? <MyShopConstructor /> : <Navigate to="/myshop" />} />
          <Route path="/myshop" element={canViewMyShop ? <MyShop /> : <Navigate to="/" />} />
          <Route path="/shop-orders" element={canViewShopOrders ? <ShopOrders /> : <Navigate to="/" />} />
          <Route path="/products" element={canViewProducts ? <Products /> : <Navigate to="/" />} />
          <Route path="/product-categories" element={canViewProducts ? <ProductCategories /> : <Navigate to="/" />} />
          <Route path="/units" element={canViewProducts ? <Units /> : <Navigate to="/" />} />
          <Route path="/counterparties" element={hasPermission(user, 'counterparties.view') ? <Counterparties /> : <Navigate to="/" />} />
          <Route path="/telegram" element={hasPermission(user, 'telegram.view') ? <TelegramPage onStatusChange={refreshTelegramStatus} /> : <Navigate to="/" />} />
          <Route path="/employees" element={canViewUsers ? <Employees /> : <Navigate to={firstNavPath} />} />
          <Route path="/roles" element={isAdmin ? <Roles /> : <Navigate to={firstNavPath} />} />
          <Route path="/branches" element={isAdmin ? <Branches /> : <Navigate to={firstNavPath} />} />
          <Route path="/departments" element={isAdmin ? <Departments /> : <Navigate to={firstNavPath} />} />
          <Route path="/tracking" element={isAdmin ? <ErrorBoundary><StaffTracking /></ErrorBoundary> : <Navigate to={firstNavPath} />} />
          <Route path="/security" element={isAdmin ? <ErrorBoundary><SecurityAdmin /></ErrorBoundary> : <Navigate to={firstNavPath} />} />
          <Route path="/audit-log" element={isAdmin ? <AuditLog /> : <Navigate to={firstNavPath} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        )}
        </div>
      </main>
    </div>
  );
}

function App() {
  return <AppContent />;
}

export default App;
