import { usePhoneAppSetup } from '../hooks/usePhoneAppSetup';

function IconHomeAdd() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="2" width="14" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v6M9 11h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 16h12l-1.2-1.5V11a4.8 4.8 0 0 0-9.6 0v3.5L6 16Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M10 18.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Компактный баннер установки/уведомлений после входа по /e/:token.
 * Один шаг за раз, крупная кнопка, не перекрывает рабочий экран двумя карточками.
 */
export default function PhoneAppSetupBanner({
  startUrl = '/',
  enabled = true,
  appLabel = 'Mahalla',
}) {
  const setup = usePhoneAppSetup({ startUrl, enabled });

  if (!setup.visible && !setup.notice) return null;

  if (!setup.visible) {
    return (
      <div className="phone-app-setup-toast" role="status">{setup.notice}</div>
    );
  }

  const isInstall = setup.step === 'install';
  const title = isInstall ? `«${appLabel}» на экран` : 'Уведомления';
  const hint = isInstall
    ? (setup.iosHint
      ? 'Safari → Поделиться → «На экран „Домой“»'
      : (setup.installPrompt
        ? 'Откроется с иконки, без браузера'
        : 'Меню браузера → «Установить» / «На экран»'))
    : 'Даже когда экран закрыт';

  let primaryLabel = 'Позже';
  let onPrimary = setup.dismissCurrent;
  let primaryDisabled = false;

  if (isInstall && setup.installPrompt) {
    primaryLabel = 'Установить';
    onPrimary = setup.install;
  } else if (isInstall && setup.iosHint) {
    primaryLabel = 'Понятно';
    onPrimary = setup.dismissCurrent;
  } else if (!isInstall) {
    primaryLabel = setup.pushLoading ? 'Подключение…' : 'Включить';
    onPrimary = setup.enablePush;
    primaryDisabled = setup.pushLoading;
  }

  return (
    <section className="phone-app-setup" aria-label="Установка приложения">
      {setup.notice && (
        <div className="phone-app-setup-toast" role="status">{setup.notice}</div>
      )}

      <div className="phone-app-setup-sheet">
        <button
          type="button"
          className="phone-app-setup-dismiss"
          onClick={setup.dismissCurrent}
          aria-label="Скрыть"
        >
          ×
        </button>

        <div className="phone-app-setup-row">
          <span className="phone-app-setup-icon" aria-hidden>
            {isInstall ? <IconHomeAdd /> : <IconBell />}
          </span>
          <div className="phone-app-setup-copy">
            <strong>{title}</strong>
            <p>{hint}</p>
          </div>
        </div>

        <div className={`phone-app-setup-actions${primaryLabel === 'Позже' || primaryLabel === 'Понятно' ? ' is-single' : ''}`}>
          <button
            type="button"
            className="btn btn-primary phone-app-setup-primary"
            onClick={onPrimary}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </button>
          {primaryLabel !== 'Позже' && primaryLabel !== 'Понятно' && (
            <button
              type="button"
              className="btn btn-ghost phone-app-setup-later"
              onClick={setup.dismissCurrent}
            >
              Не сейчас
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
