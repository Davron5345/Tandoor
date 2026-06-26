import { isNativeApp } from '../utils/nativeApp';
import { isStandaloneApp } from '../utils/pwaPush';
import { FALLBACK_APK_URL } from './SnabAppPanel';

function statusBadge(ok, yesLabel, noLabel) {
  return (
    <span className={`badge ${ok ? 'badge-success' : 'badge-warning'}`}>
      {ok ? yesLabel : noLabel}
    </span>
  );
}

export default function SnabProfileView({
  user,
  branchName,
  pushState,
  pushBannerText,
  locationEnabled,
  locationLoading,
  appInfo,
  apkUpdate,
  apkUpdating,
  pushLoading,
  installPrompt,
  onBack,
  onEnablePush,
  onEnableLocation,
  onApkUpdate,
  onInstall,
  onRefreshInfo,
}) {
  const displayName = user?.name || user?.username || '—';
  const native = isNativeApp();
  const standalone = isStandaloneApp() || pushState.standalone;
  const showWebInstall = !native && !standalone;
  const showPushAction = !pushState.subscribed && !pushState.blockReason;
  const apkHref = typeof window !== 'undefined'
    ? `${window.location.origin}${FALLBACK_APK_URL}`
    : FALLBACK_APK_URL;

  return (
    <div className="warehouse-orders-mobile-detail snab-profile-view">
      <header className="warehouse-orders-mobile-detail-header">
        <button type="button" className="warehouse-orders-mobile-back" onClick={onBack}>
          ← Назад
        </button>
        <h2>Мой профиль</h2>
      </header>

      <div className="warehouse-orders-mobile-detail-body snab-profile-body">
        <div className="snab-profile-hero">
          <div className="snab-profile-avatar" aria-hidden>{displayName.charAt(0).toUpperCase()}</div>
          <div>
            <strong>{displayName}</strong>
            <span>{user?.username}</span>
          </div>
        </div>

        <div className="snab-profile-grid">
          <div><span>Роль</span><div>{user?.role_label || user?.role || '—'}</div></div>
          <div><span>Филиал</span><div>{branchName || '—'}</div></div>
          <div><span>Push-уведомления</span><div>{statusBadge(pushState.subscribed, 'Включены', 'Выключены')}</div></div>
          <div><span>Геолокация</span><div>{statusBadge(locationEnabled, 'Включена', 'Выключена')}</div></div>
        </div>

        {apkUpdate && (
          <section className="snab-profile-alert snab-profile-alert--update">
            <strong>Доступно обновление {apkUpdate.versionName}</strong>
            <p>
              Установлена версия {apkUpdate.installedName || apkUpdate.installedVersion}.
              Интерфейс обновляется с сервера автоматически; APK нужен только для новых функций Android.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={onApkUpdate} disabled={apkUpdating}>
              {apkUpdating ? 'Скачивание…' : 'Обновить APK'}
            </button>
          </section>
        )}

        {!pushState.subscribed && (
          <section className="snab-profile-alert">
            <strong>Включите push-уведомления</strong>
            <p>{pushBannerText}</p>
            {showPushAction && (
              <button type="button" className="btn btn-primary btn-block" onClick={onEnablePush} disabled={pushLoading}>
                {pushLoading ? 'Подключение…' : 'Включить уведомления'}
              </button>
            )}
          </section>
        )}

        {showWebInstall && (
          <section className="snab-profile-alert">
            <strong>Установите приложение «Снабжение»</strong>
            <p>Скачайте Android-приложение для фоновой геолокации или установите PWA из Chrome.</p>
            <div className="snab-profile-alert-actions">
              <a className="btn btn-primary btn-block" href={apkHref}>
                Скачать Android APK
              </a>
              {installPrompt && (
                <button type="button" className="btn btn-ghost btn-block" onClick={onInstall}>
                  Установить PWA
                </button>
              )}
            </div>
          </section>
        )}

        {!locationEnabled && (
          <section className="snab-profile-alert">
            <strong>{native ? 'Включите геолокацию' : 'Разрешите геолокацию'}</strong>
            <p>
              {native
                ? 'Разрешите доступ к местоположению «всегда» — администратор видит маршрут снабженца.'
                : 'Администратор видит ваше местоположение при работе с заказами.'}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-block"
              onClick={onEnableLocation}
              disabled={locationLoading}
            >
              {locationLoading ? '…' : (native ? 'Фоновая геолокация' : 'Включить геолокацию')}
            </button>
          </section>
        )}

        {!native && standalone && (
          <p className="snab-profile-hint snab-profile-hint-ok">Приложение установлено</p>
        )}

        <div className="snab-profile-version card">
          <h3>Версия приложения</h3>
          {appInfo?.isNative ? (
            <>
              <div className="snab-profile-version-row">
                <span>Установлено</span>
                <strong>{appInfo.installedVersion} (build {appInfo.installedBuild})</strong>
              </div>
              <div className="snab-profile-version-row">
                <span>На сервере</span>
                <strong>{appInfo.serverVersion || '—'} (build {appInfo.serverBuild || '—'})</strong>
              </div>
              <div className="snab-profile-version-row">
                <span>Интерфейс</span>
                <strong>{appInfo.remoteUi ? 'Обновляется с сервера' : 'Встроенный (устарел)'}</strong>
              </div>
            </>
          ) : (
            <div className="snab-profile-version-row">
              <span>Веб-сборка</span>
              <strong>{appInfo?.webBuildId || '—'}</strong>
            </div>
          )}
          {appInfo?.webUpdateAvailable && (
            <p className="snab-profile-hint">Доступно обновление интерфейса — перезапустите приложение.</p>
          )}
          {!apkUpdate && !appInfo?.updateAvailable && appInfo?.isNative && appInfo?.remoteUi && (
            <p className="snab-profile-hint snab-profile-hint-ok">У вас актуальная версия APK. Интерфейс обновляется автоматически.</p>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshInfo}>
            Проверить обновления
          </button>
        </div>
      </div>
    </div>
  );
}
