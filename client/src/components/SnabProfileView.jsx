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
  locationEnabled,
  appInfo,
  apkUpdate,
  apkUpdating,
  pushLoading,
  onBack,
  onEnablePush,
  onEnableLocation,
  onApkUpdate,
  onRefreshInfo,
}) {
  const displayName = user?.name || user?.username || '—';

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

        {!pushState.subscribed && !pushState.blockReason && (
          <button type="button" className="btn btn-primary btn-block" onClick={onEnablePush} disabled={pushLoading}>
            {pushLoading ? 'Подключение…' : 'Включить уведомления'}
          </button>
        )}
        {pushState.blockReason && (
          <div className="snab-profile-hint">{pushState.blockReason}</div>
        )}
        {!locationEnabled && (
          <button type="button" className="btn btn-ghost btn-block" onClick={onEnableLocation}>
            Включить геолокацию
          </button>
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
          {(apkUpdate || appInfo?.updateAvailable) && (
            <button type="button" className="btn btn-primary btn-block" onClick={onApkUpdate} disabled={apkUpdating}>
              {apkUpdating ? 'Скачивание…' : `Обновить до ${apkUpdate?.versionName || appInfo?.serverVersion}`}
            </button>
          )}
          {!appInfo?.updateAvailable && appInfo?.isNative && appInfo?.remoteUi && (
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
