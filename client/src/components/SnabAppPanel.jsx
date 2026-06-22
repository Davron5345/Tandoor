import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

const FALLBACK_APK_URL = '/downloads/snabzenie.apk';

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
        setInfo({
          mobileUrl: `${origin}/snab`,
          apkUrl: FALLBACK_APK_URL,
        });
      });
  }, []);

  const mobileUrl = info?.mobileUrl || (typeof window !== 'undefined' ? `${window.location.origin}/snab` : '/snab');
  const apkHref = info?.apkDownloadUrl || info?.apkUrl || (
    typeof window !== 'undefined' ? `${window.location.origin}${FALLBACK_APK_URL}` : FALLBACK_APK_URL
  );

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
          <p>Снабженец: скачал APK → установил → вошёл → включил геолокацию. Без Play Market.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggleCollapsed}>
          {collapsed ? 'Показать' : 'Свернуть'}
        </button>
      </div>

      {!collapsed && (
        <div className="snab-app-panel-body">
          <div className="snab-app-panel-grid">
            <section className="snab-app-panel-block snab-app-panel-block--apk">
              <span className="snab-app-panel-badge">Для снабженца</span>
              <h3>Скачать Android APK</h3>
              <p>Фоновый GPS — координаты передаются даже при свёрнутом приложении.</p>
              <ol className="snab-app-panel-steps">
                <li><strong>Не устанавливайте из Telegram</strong> — файл может повредиться</li>
                <li>Откройте ссылку в <strong>Chrome</strong> на телефоне и скачайте APK</li>
                <li>Если была старая версия — сначала удалите приложение «Снабжение»</li>
                <li>Установите, войдите, включите «Фоновая геолокация»</li>
              </ol>
              <div className="snab-app-panel-actions">
                <a className="btn btn-primary btn-sm" href={apkHref}>
                  Скачать APK
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleCopy('apk', apkHref)}>
                  {copied === 'apk' ? 'Скопировано' : 'Копировать ссылку'}
                </button>
              </div>
              <img
                className="snab-app-panel-qr snab-app-panel-qr--inline"
                src={qrImageUrl(apkHref)}
                width={140}
                height={140}
                alt="QR для скачивания APK"
              />
            </section>

            <section className="snab-app-panel-block">
              <h3>Веб-версия (PWA)</h3>
              <p>Без APK — геолокация только при открытом приложении.</p>
              <div className="snab-app-panel-actions">
                <a className="btn btn-primary btn-sm" href={mobileUrl} target="_blank" rel="noopener noreferrer">
                  Открыть /snab
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleCopy('link', mobileUrl)}>
                  {copied === 'link' ? 'Скопировано' : 'Копировать ссылку'}
                </button>
              </div>
            </section>

            <section className="snab-app-panel-block snab-app-panel-block--qr">
              <h3>QR — веб-версия</h3>
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
              Версия: {String(info.version.version).slice(0, 8)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export { FALLBACK_APK_URL };
