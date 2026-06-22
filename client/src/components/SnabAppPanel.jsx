import { useCallback, useEffect, useState } from 'react';
import { api, getApiBaseUrl } from '../api';

function qrImageUrl(url) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(url)}`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

export default function SnabAppPanel() {
  const [info, setInfo] = useState(null);
  const [copied, setCopied] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('snab-app-panel-collapsed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    api.getSnabInstallInfo()
      .then(setInfo)
      .catch(() => {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setInfo({ mobileUrl: `${origin}/snab`, apkUrl: null, apkOnServer: false });
      });
  }, []);

  const mobileUrl = info?.mobileUrl || (typeof window !== 'undefined' ? `${window.location.origin}/snab` : '/snab');
  const apkHref = info?.apkOnServer
    ? `${getApiBaseUrl()}/api/app/snab-apk`
    : info?.apkUrl;

  const handleCopy = useCallback(async (label, text) => {
    try {
      await copyText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 2000);
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('snab-app-panel-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
  };

  return (
    <div className={`card snab-app-panel${collapsed ? ' is-collapsed' : ''}`}>
      <div className="snab-app-panel-head">
        <div>
          <h2>Приложение «Снабжение»</h2>
          <p>Для снабженца: заказы, push-уведомления и фоновая геолокация без Play Market</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleCollapsed}>
          {collapsed ? 'Показать' : 'Свернуть'}
        </button>
      </div>

      {!collapsed && (
        <div className="snab-app-panel-body">
          <div className="snab-app-panel-grid">
            <section className="snab-app-panel-block snab-app-panel-block--apk">
              <span className="snab-app-panel-badge">Рекомендуется</span>
              <h3>Android APK</h3>
              <p>Фоновый GPS — координаты передаются даже при свёрнутом приложении.</p>
              <ul className="snab-app-panel-steps">
                <li>Скачайте и установите APK на телефон снабженца</li>
                <li>Войдите под его логином</li>
                <li>Нажмите «Фоновая геолокация» и разрешите доступ «Всегда»</li>
              </ul>
              <div className="snab-app-panel-actions">
                {apkHref ? (
                  <a className="btn btn-primary btn-sm" href={apkHref} download={info?.apkOnServer ? 'snabzenie.apk' : undefined}>
                    Скачать APK
                  </a>
                ) : (
                  <a
                    className="btn btn-primary btn-sm"
                    href={info?.githubBuildUrl || 'https://github.com/Davron5345/Tandoor/actions/workflows/android-apk.yml'}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Собрать APK (GitHub)
                  </a>
                )}
                {!apkHref && (
                  <span className="snab-app-panel-hint">
                    Actions → Android APK → Artifacts → загрузите `snab.apk` в папку data на сервере
                  </span>
                )}
              </div>
            </section>

            <section className="snab-app-panel-block">
              <h3>PWA в браузере</h3>
              <p>Без установки APK — только пока приложение открыто.</p>
              <div className="snab-app-panel-actions">
                <a className="btn btn-primary btn-sm" href={mobileUrl} target="_blank" rel="noopener noreferrer">
                  Открыть на телефоне
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleCopy('link', mobileUrl)}>
                  {copied === 'link' ? 'Скопировано' : 'Копировать ссылку'}
                </button>
              </div>
              <p className="snab-app-panel-note">Chrome → «Установить приложение» или отсканируйте QR</p>
            </section>

            <section className="snab-app-panel-block snab-app-panel-block--qr">
              <h3>QR для телефона</h3>
              <img
                className="snab-app-panel-qr"
                src={qrImageUrl(mobileUrl)}
                width={180}
                height={180}
                alt={`QR: ${mobileUrl}`}
              />
              <code className="snab-app-panel-url">{mobileUrl}</code>
            </section>
          </div>

          {info?.version?.version && (
            <p className="snab-app-panel-version">
              Версия веб-приложения: {String(info.version.version).slice(0, 8)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
