import { usePhoneAppSetup } from '../hooks/usePhoneAppSetup';

/**
 * Баннер «на экран + уведомления» для телефонных экранов после входа по /e/:token.
 */
export default function PhoneAppSetupBanner({
  startUrl = '/',
  enabled = true,
  appLabel = 'Mahalla',
}) {
  const setup = usePhoneAppSetup({ startUrl, enabled });

  if (!setup.visible) {
    return setup.notice ? (
      <div className="phone-app-setup-notice" role="status">{setup.notice}</div>
    ) : null;
  }

  return (
    <section className="phone-app-setup" aria-label="Установка приложения">
      {setup.notice && (
        <div className="phone-app-setup-notice" role="status">{setup.notice}</div>
      )}

      {setup.needsInstall && (
        <div className="phone-app-setup-card">
          <div className="phone-app-setup-text">
            <strong>Установите «{appLabel}»</strong>
            {setup.iosHint ? (
              <p>
                Safari → кнопка «Поделиться» → «На экран „Домой“». Откроется как приложение, без адресной строки.
              </p>
            ) : (
              <p>
                Добавьте на домашний экран — вход по вашей ссылке откроется как приложение.
              </p>
            )}
          </div>
          <div className="phone-app-setup-actions">
            {setup.installPrompt && (
              <button type="button" className="btn btn-primary btn-sm" onClick={setup.install}>
                Установить
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={setup.dismissInstall}>
              Позже
            </button>
          </div>
        </div>
      )}

      {setup.needsPush && (
        <div className="phone-app-setup-card">
          <div className="phone-app-setup-text">
            <strong>Включите уведомления</strong>
            <p>Важные оповещения придут даже когда приложение закрыто.</p>
          </div>
          <div className="phone-app-setup-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={setup.enablePush}
              disabled={setup.pushLoading}
            >
              {setup.pushLoading ? 'Подключение…' : 'Включить'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={setup.dismissPush}>
              Позже
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
