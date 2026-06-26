import { useCallback, useEffect, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Navigate } from 'react-router-dom';
import { api, formatDateTime, formatMoney } from '../api';
import { useAuth } from '../AuthContext';
import { useBranch } from '../BranchContext';
import { useTheme } from '../ThemeContext';
import { hasPermission } from '../permissions';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import Login from './Login';
import ChangePassword from './ChangePassword';
import ShopOrderItem from '../components/ShopOrderItem';
import { IconNavWarehouse, IconNavLogout, IconNavSun, IconNavMoon, IconNavRefresh, IconNavUser } from '../components/NavIcons';
import SnabProfileView from '../components/SnabProfileView';
import {
  getPushSubscriptionState,
  isPushSupported,
  isStandaloneApp,
  resumeNativePushIfNeeded,
  subscribeToOrderPush,
} from '../utils/pwaPush';
import { useStaffLocationPing, requestStaffLocationPermission } from '../hooks/useStaffLocationPing';
import { isNativeApp, isBackgroundLocationEnabled } from '../utils/nativeApp';
import { downloadAndInstallSnabApk, getSnabAppInfo } from '../utils/nativeApkUpdate';
import { FALLBACK_APK_URL } from '../components/SnabAppPanel';

const STATUS_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'processing', label: 'В работе' },
  { value: 'done', label: 'Готовы' },
  { value: 'cancelled', label: 'Отмена' },
];

const STATUS_ACTIONS = [
  { value: 'new', label: 'Новый' },
  { value: 'processing', label: 'В работе' },
  { value: 'done', label: 'Выполнен' },
  { value: 'cancelled', label: 'Отменён' },
];

const STATUS_CLASS = {
  new: 'shop-order-status-new',
  processing: 'shop-order-status-processing',
  done: 'shop-order-status-done',
  cancelled: 'shop-order-status-cancelled',
};

export default function ShopOrdersMobile() {
  const { user, loading: authLoading, logout } = useAuth();
  const { branchName, branchId } = useBranch();
  const { theme, toggleTheme } = useTheme();
  const canView = hasPermission(user, 'shop_orders.view');
  const canEdit = hasPermission(user, 'shop_orders.edit');

  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [notice, setNotice] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pushState, setPushState] = useState({ supported: false, subscribed: false, standalone: false });
  const [pushLoading, setPushLoading] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(() => (
    isNativeApp() && isBackgroundLocationEnabled()
  ));
  const [locationLoading, setLocationLoading] = useState(false);
  const [apkUpdate, setApkUpdate] = useState(null);
  const [apkUpdating, setApkUpdating] = useState(false);
  const [appInfo, setAppInfo] = useState(null);
  const [dismissSetup, setDismissSetup] = useState(() => {
    try { return localStorage.getItem('warehouse-pwa-setup-dismiss') === '1'; } catch { return false; }
  });

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.getShopOrders(statusFilter ? { status: statusFilter } : {});
      setOrders(data);
    } catch (err) {
      if (!silent) {
        setOrders([]);
        setNotice(err.message || 'Не удалось загрузить заказы');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter, branchId]);

  useEffect(() => { if (canView) load(); }, [load, canView]);
  useAutoRefresh(
    () => load({ silent: true }),
    [statusFilter, branchId],
    { enabled: canView && view === 'list', intervalMs: 60_000 },
  );

  useStaffLocationPing(canView && view === 'list');

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    html.classList.add('public-shop-lock');
    body.classList.add('public-shop-lock');
    root?.classList.add('public-shop-lock');

    const viewport = document.querySelector('meta[name="viewport"]');
    const prevViewport = viewport?.getAttribute('content') || '';
    viewport?.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
    );

    return () => {
      html.classList.remove('public-shop-lock');
      body.classList.remove('public-shop-lock');
      root?.classList.remove('public-shop-lock');
      if (viewport && prevViewport) viewport.setAttribute('content', prevViewport);
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Снабжение — заказы';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  useEffect(() => {
    const onInstall = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', onInstall);
    return () => window.removeEventListener('beforeinstallprompt', onInstall);
  }, []);

  useEffect(() => {
    if (!canView) return undefined;
    let cancelled = false;
    const build = appInfo?.installedBuild || 0;
    getPushSubscriptionState(build).then((state) => {
      if (!cancelled) setPushState(state);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [canView, branchId, appInfo?.installedBuild]);

  const refreshAppInfo = useCallback(async () => {
    try {
      const info = await getSnabAppInfo(api);
      setAppInfo(info);
      const installed = info.installedBuild || 0;
      const server = info.serverBuild || 0;
      if (info.updateAvailable && installed > 0 && server > installed) {
        setApkUpdate({
          versionName: info.serverVersion,
          versionCode: info.serverBuild,
          apkUrl: info.apkUrl,
          installedVersion: installed,
          installedName: info.installedVersion,
        });
      } else {
        setApkUpdate(null);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!canView) return undefined;
    refreshAppInfo();
    const timer = window.setInterval(refreshAppInfo, 30 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAppInfo();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canView, refreshAppInfo]);

  useEffect(() => {
    if (!canView || !isNativeApp()) return undefined;
    const build = appInfo?.installedBuild || 0;

    const finishPush = async () => {
      const ok = await resumeNativePushIfNeeded(api, build);
      if (!ok) return;
      const state = await getPushSubscriptionState(build);
      setPushState(state);
      setNotice('Уведомления включены — администратор может присылать сообщения');
    };

    finishPush().catch(() => {});

    const resumeListener = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) finishPush().catch(() => {});
    });

    return () => {
      resumeListener.then((h) => h.remove()).catch(() => {});
    };
  }, [canView, appInfo?.installedBuild]);

  const handleApkUpdate = async () => {
    const url = apkUpdate?.apkUrl || appInfo?.apkUrl;
    if (!url) return;
    setApkUpdating(true);
    try {
      await downloadAndInstallSnabApk(url);
      setNotice('Установщик APK открыт — подтвердите обновление');
    } catch (err) {
      setNotice(err.message || 'Не удалось обновить приложение');
    } finally {
      setApkUpdating(false);
    }
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  const handleEnablePush = async () => {
    setPushLoading(true);
    try {
      const build = appInfo?.installedBuild || 0;
      await subscribeToOrderPush(api, build);
      const state = await getPushSubscriptionState(build);
      setPushState(state);
      setNotice('Уведомления включены — администратор может присылать сообщения');
    } catch (err) {
      setNotice(err.message || 'Не удалось включить уведомления');
    } finally {
      setPushLoading(false);
    }
  };

  const handleEnableLocation = async () => {
    setLocationLoading(true);
    try {
      await requestStaffLocationPermission();
      setLocationEnabled(true);
      setNotice(isNativeApp()
        ? 'Фоновая геолокация включена — координаты передаются даже при свёрнутом приложении'
        : 'Геолокация включена — администратор видит ваше местоположение');
    } catch (err) {
      setNotice(err.message || 'Разрешите доступ к геолокации в настройках телефона');
    } finally {
      setLocationLoading(false);
    }
  };

  const dismissSetupBanner = () => {
    setDismissSetup(true);
    try { localStorage.setItem('warehouse-pwa-setup-dismiss', '1'); } catch { /* ignore */ }
  };

  const showSetupBanner = !dismissSetup && (
    isNativeApp()
      ? !locationEnabled
      : (
        !pushState.standalone && !isStandaloneApp()
        || !locationEnabled
      )
  );

  const showPushBanner = canView && view === 'list' && (
    isNativeApp()
      ? !pushState.subscribed
      : isPushSupported() && (pushState.permission !== 'granted' || !pushState.subscribed)
  );

  const pushBannerText = pushState.blockReason
    || 'Войдите в приложение и нажмите кнопку ниже — без этого админ не сможет присылать сообщения.';

  const openOrder = async (order) => {
    try {
      const full = await api.getShopOrder(order.id);
      setSelected(full);
      setView('detail');
    } catch (err) {
      setNotice(err.message || 'Не удалось открыть заказ');
    }
  };

  const closeDetail = () => {
    setView('list');
    setSelected(null);
  };

  const changeStatus = async (status) => {
    if (!selected || !canEdit) return;
    setUpdating(true);
    try {
      const updated = await api.updateShopOrderStatus(selected.id, status);
      setSelected(updated);
      setNotice('Статус обновлён');
      load({ silent: true });
    } catch (err) {
      setNotice(err.message || 'Не удалось обновить статус');
    } finally {
      setUpdating(false);
    }
  };

  if (authLoading) {
    return (
      <div className="warehouse-orders-mobile-shell">
        <div className="warehouse-orders-mobile-empty">Загрузка...</div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  if (user.must_change_password) {
    return <ChangePassword />;
  }

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="warehouse-orders-mobile-shell public-shop-snappy">
      {notice && (
        <div className="warehouse-orders-mobile-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Закрыть">×</button>
        </div>
      )}

      {view === 'list' && (
        <>
          <header className="warehouse-orders-mobile-header">
            <div className="warehouse-orders-mobile-brand">
              <span className="warehouse-orders-mobile-mark" aria-hidden><IconNavWarehouse /></span>
              <div>
                <strong>Снабжение</strong>
                <span>{branchName}</span>
              </div>
            </div>
            <div className="warehouse-orders-mobile-header-actions">
              <button
                type="button"
                className="warehouse-orders-mobile-icon-btn"
                onClick={() => setView('profile')}
                aria-label="Мой профиль"
                title="Мой профиль"
              >
                <IconNavUser />
              </button>
              <button
                type="button"
                className="warehouse-orders-mobile-icon-btn"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
                title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              >
                {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
              </button>
              <button type="button" className="warehouse-orders-mobile-icon-btn" onClick={() => load()} aria-label="Обновить" title="Обновить">
                <IconNavRefresh />
              </button>
              <button type="button" className="warehouse-orders-mobile-icon-btn" onClick={logout} aria-label="Выйти" title="Выйти">
                <IconNavLogout />
              </button>
            </div>
          </header>

          {apkUpdate && view === 'list' && (
            <div className="warehouse-pwa-setup warehouse-apk-update">
              <div className="warehouse-pwa-setup-text">
                <strong>Доступно обновление {apkUpdate.versionName}</strong>
                <span>
                  Установлена версия {apkUpdate.installedName || apkUpdate.installedVersion}.
                  Интерфейс обновляется с сервера автоматически; APK нужен только для новых функций Android.
                </span>
              </div>
              <div className="warehouse-pwa-setup-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleApkUpdate}
                  disabled={apkUpdating}
                >
                  {apkUpdating ? 'Скачивание…' : 'Обновить APK'}
                </button>
              </div>
            </div>
          )}

          {showPushBanner && (
            <div className="warehouse-pwa-setup warehouse-push-setup">
              <div className="warehouse-pwa-setup-text">
                <strong>Включите push-уведомления</strong>
                <span>{pushBannerText}</span>
              </div>
              <div className="warehouse-pwa-setup-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={handleEnablePush} disabled={pushLoading || !!pushState.blockReason}>
                  {pushLoading ? '...' : 'Включить уведомления'}
                </button>
              </div>
            </div>
          )}

          {showSetupBanner && (
            <div className="warehouse-pwa-setup">
              <div className="warehouse-pwa-setup-text">
                <strong>
                  {isNativeApp() ? 'Включите геолокацию' : 'Установите приложение «Снабжение»'}
                </strong>
                <span>
                  {isNativeApp()
                    ? 'Разрешите доступ к местоположению «всегда» — администратор видит маршрут снабженца.'
                    : 'Скачайте Android-приложение для фоновой геолокации или установите PWA из Chrome.'}
                </span>
              </div>
              <div className="warehouse-pwa-setup-actions">
                {!isNativeApp() && !isStandaloneApp() && (
                  <a className="btn btn-primary btn-sm" href={`${window.location.origin}${FALLBACK_APK_URL}`}>
                    Скачать Android APK
                  </a>
                )}
                {!isNativeApp() && installPrompt && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleInstall}>
                    Установить приложение
                  </button>
                )}
                {!locationEnabled && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleEnableLocation} disabled={locationLoading}>
                    {locationLoading ? '...' : (isNativeApp() ? 'Фоновая геолокация' : 'Геолокация')}
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={dismissSetupBanner}>
                  Скрыть
                </button>
              </div>
            </div>
          )}

          {!isNativeApp() && isStandaloneApp() && (
            <div className="warehouse-pwa-installed-badge">Приложение установлено</div>
          )}

          <div className="warehouse-orders-mobile-filters" role="tablist" aria-label="Фильтр по статусу">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value || 'all'}
                type="button"
                role="tab"
                aria-selected={statusFilter === opt.value}
                className={`warehouse-orders-mobile-chip${statusFilter === opt.value ? ' active' : ''}`}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="warehouse-orders-mobile-list">
            {loading && orders.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Загрузка...</div>
            ) : orders.length === 0 ? (
              <div className="warehouse-orders-mobile-empty">Заказов пока нет</div>
            ) : (
              orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  className="warehouse-orders-mobile-card"
                  onClick={() => openOrder(order)}
                >
                  <div className="warehouse-orders-mobile-card-top">
                    <strong>№{order.number}</strong>
                    <span className={`shop-order-status ${STATUS_CLASS[order.status] || ''}`}>
                      {order.status_label || order.status}
                    </span>
                  </div>
                  <div className="warehouse-orders-mobile-card-meta">
                    <span>{formatDateTime(order.created_at)}</span>
                    {order.department_name && <span>{order.department_name}</span>}
                  </div>
                  <div className="warehouse-orders-mobile-card-client">{order.customer_name}</div>
                  <div className="warehouse-orders-mobile-card-bottom">
                    <span>{order.delivery_type === 'delivery' ? 'Доставка' : 'Самовывоз'}</span>
                    <strong>{formatMoney(order.total_amount)}</strong>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {view === 'profile' && (
        <SnabProfileView
          user={user}
          branchName={branchName}
          pushState={pushState}
          locationEnabled={locationEnabled}
          appInfo={appInfo}
          apkUpdate={apkUpdate}
          apkUpdating={apkUpdating}
          pushLoading={pushLoading}
          onBack={() => setView('list')}
          onEnablePush={handleEnablePush}
          onEnableLocation={handleEnableLocation}
          onApkUpdate={handleApkUpdate}
          onRefreshInfo={refreshAppInfo}
        />
      )}

      {view === 'detail' && selected && (
        <div className="warehouse-orders-mobile-detail">
          <header className="warehouse-orders-mobile-detail-header">
            <button type="button" className="warehouse-orders-mobile-back" onClick={closeDetail}>
              ← Назад
            </button>
            <h2>Заказ №{selected.number}</h2>
            <button
              type="button"
              className="warehouse-orders-mobile-icon-btn warehouse-orders-mobile-detail-theme"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <IconNavSun /> : <IconNavMoon />}
            </button>
          </header>

          <div className="warehouse-orders-mobile-detail-body">
            <div className="warehouse-orders-mobile-detail-total">
              <span>Итого</span>
              <strong>{formatMoney(selected.total_amount)}</strong>
            </div>

            {canEdit && (
              <div className="shop-order-status-actions">
                <span>Статус заказа</span>
                <div className="shop-order-status-buttons">
                  {STATUS_ACTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`btn btn-sm${selected.status === opt.value ? ' btn-primary' : ' btn-ghost'}`}
                      disabled={updating || selected.status === opt.value}
                      onClick={() => changeStatus(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="shop-order-detail-grid warehouse-orders-mobile-detail-grid">
              <div><span>Клиент</span><strong>{selected.customer_name}</strong></div>
              {selected.department_name && (
                <div><span>Отдел</span><strong>{selected.department_name}</strong></div>
              )}
              <div><span>Телефон</span><strong>{selected.customer_phone}</strong></div>
              <div><span>Способ</span><strong>{selected.delivery_type === 'delivery' ? 'Доставка' : 'Самовывоз'}</strong></div>
              <div><span>Дата и время</span><strong>{formatDateTime(selected.created_at)}</strong></div>
              {selected.address && (
                <div className="shop-order-detail-wide"><span>Адрес</span><strong>{selected.address}</strong></div>
              )}
              {selected.comment && (
                <div className="shop-order-detail-wide"><span>Комментарий</span><strong>{selected.comment}</strong></div>
              )}
            </div>

            <div className="shop-order-items warehouse-orders-mobile-items">
              <h3>Товары</h3>
              <ul>
                {(selected.items || []).map((item) => (
                  <ShopOrderItem key={item.id} item={item} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
