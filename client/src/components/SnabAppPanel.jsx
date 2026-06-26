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
  const [updateInfo, setUpdateInfo] = useState(null);
  const [copied, setCopied] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('snab-app-panel-collapsed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    Promise.all([
      api.getSnabInstallInfo().catch(() => null),
      api.getSnabUpdateInfo().catch(() => null),
    ]).then(([installInfo, snabUpdate]) => {
      if (installInfo) {
        setInfo(installInfo);
      } else {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setInfo({
          mobileUrl: `${origin}/snab`,
          apkUrl: FALLBACK_APK_URL,
        });
      }
      setUpdateInfo(snabUpdate);
    });
  }, []);

  const mobileUrl = info?.mobileUrl || (typeof window !== 'undefined' ? `${window.location.origin}/snab` : '/snab');
  const githubApkHref = info?.githubApkUrl || 'https://github.com/Davron5345/Tandoor/releases/latest/download/snabzenie.apk';
  const siteApkHref = info?.apkDownloadUrl || info?.apkUrl || (
    typeof window !== 'undefined' ? `${window.location.origin}${FALLBACK_APK_URL}` : FALLBACK_APK_URL
  );
  // GitHub Releases обновляется сразу после сборки; зеркало на сайте может отставать.
  const apkHref = githubApkHref;
  const apkVersionLabel = updateInfo?.versionName
    ? `${updateInfo.versionName} (build ${updateInfo.versionCode})`
    : null;

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
          <h2>Приложение «Mahalla Снабжение»</h2>
          <p>
            Снабженец: скачал APK один раз → установил → вошёл → включил уведомления и геолокацию.
            Интерфейс обновляется с сервера автоматически.
          </p>
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
              <p>
                Фоновый GPS, push-уведомления от админа, профиль сотрудника.
                {apkVersionLabel && <> Актуальный APK: <strong>{apkVersionLabel}</strong>.</>}
              </p>
              <ol className="snab-app-panel-steps">
                <li><strong>Не устанавливайте из Telegram</strong> — файл может повредиться</li>
                <li>Откройте ссылку в <strong>Chrome</strong> на телефоне и скачайте APK</li>
                <li>Установите (при обновлении можно нажать «Обновить APK» в профиле приложения)</li>
                <li>Войдите, нажмите <strong>«Включить уведомления»</strong> и разрешите геолокацию «всегда»</li>
                <li>Иконка <strong>профиля</strong> в шапке — версия, push и обновления</li>
              </ol>
              <details className="snab-app-panel-xiaomi">
                <summary>Ошибка «Установщик пакетов сбой» (Xiaomi / Redmi)</summary>
                <ol className="snab-app-panel-steps">
                  <li>Удалите файл <code>snabzenie.apk</code> из «Загрузок»</li>
                  <li>Настройки → Приложения → показать все → <strong>Установщик пакетов</strong> → Память → <strong>Очистить кэш и данные</strong></li>
                  <li>Перезагрузите телефон</li>
                  <li>Скачайте заново в Chrome и откройте через приложение <strong>Файлы</strong> (не из уведомления)</li>
                  <li>Если не помогло — скачайте с <strong>GitHub</strong> (запасная ссылка ниже)</li>
                </ol>
              </details>
              <div className="snab-app-panel-actions">
                <a className="btn btn-primary btn-sm" href={apkHref}>
                  Скачать APK
                </a>
                <a className="btn btn-ghost btn-sm" href={siteApkHref}>
                  С сайта (зеркало)
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
              <p>Без APK — геолокация только при открытом приложении, push через браузер.</p>
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

          <p className="snab-app-panel-version">
            {apkVersionLabel && <>APK на сервере: {apkVersionLabel} · </>}
            {info?.version?.version && <>Сборка сайта: {String(info.version.version).slice(0, 8)}</>}
          </p>
        </div>
      )}
    </div>
  );
}

export { FALLBACK_APK_URL };
