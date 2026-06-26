import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { APP_BUILD_ID } from '../appBuildId';
import { getApiBaseUrl, isNativeApp, isRemoteCapacitorApp } from './nativeApp';

const ApkInstaller = registerPlugin('ApkInstaller');
const CACHED_APK_META_KEY = 'snab-apk-cache-meta';
const DEFAULT_GITHUB_APK_URL = 'https://github.com/Davron5345/Tandoor/releases/latest/download/snabzenie.apk';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getCachedApkPath(versionCode) {
  return `snab-update-v${versionCode}.apk`;
}

function readCachedApkMeta() {
  try {
    const raw = localStorage.getItem(CACHED_APK_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedApkMeta(meta) {
  try {
    localStorage.setItem(CACHED_APK_META_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
}

function buildProgressLabel(loaded, total, percent) {
  if (percent != null && total) {
    return `Скачивание… ${percent}% (${formatBytes(loaded)} / ${formatBytes(total)})`;
  }
  if (loaded > 0) {
    return `Скачивание… ${formatBytes(loaded)}`;
  }
  return 'Скачивание…';
}

function normalizeProgress(event) {
  const loaded = Number(event?.loaded) || 0;
  const total = Number(event?.total) || null;
  const percent = event?.percent != null
    ? Number(event.percent)
    : (total ? Math.min(99, Math.round((loaded / total) * 100)) : null);
  return {
    phase: event?.phase || 'downloading',
    loaded,
    total: total || null,
    percent,
    label: event?.label || buildProgressLabel(loaded, total, percent),
  };
}

async function validateCachedApk(versionCode, expectedSize = null) {
  if (!isNativeApp() || !versionCode) return false;

  if (Capacitor.isPluginAvailable('ApkInstaller')) {
    try {
      const result = await ApkInstaller.validateApk({ versionCode });
      if (result?.valid) return true;
    } catch {
      // fallback below
    }
  }

  try {
    const stat = await Filesystem.stat({
      path: getCachedApkPath(versionCode),
      directory: Directory.Cache,
    });
    const size = stat.size || 0;
    if (size < 3 * 1024 * 1024) return false;
    if (expectedSize) {
      return size >= expectedSize * 0.9 && size <= expectedSize * 1.05;
    }
    return size > 5 * 1024 * 1024;
  } catch {
    return false;
  }
}

export async function hasCachedApk(versionCode, apkSize = null) {
  if (!isNativeApp() || !versionCode) return false;
  const meta = readCachedApkMeta();
  if (meta?.versionCode !== versionCode) return false;
  return validateCachedApk(versionCode, apkSize);
}

async function downloadApkToCache(versionCode, apkSize, apkUrl, onProgress) {
  const url = apkUrl || DEFAULT_GITHUB_APK_URL;
  const path = getCachedApkPath(versionCode);

  const progressListener = await Filesystem.addListener('progress', (event) => {
    const loaded = Number(event.bytes) || 0;
    const total = Number(event.contentLength) || apkSize || null;
    const percent = total
      ? Math.min(99, Math.round((loaded / total) * 100))
      : (loaded > 0 ? null : 0);
    onProgress?.(normalizeProgress({
      phase: 'downloading',
      loaded,
      total,
      percent,
    }));
  });

  onProgress?.(normalizeProgress({
    phase: 'downloading',
    loaded: 0,
    total: apkSize || null,
    percent: 0,
    label: 'Подключение к серверу…',
  }));

  try {
    await Filesystem.downloadFile({
      url,
      path,
      directory: Directory.Cache,
      progress: true,
    });

    if (!(await validateCachedApk(versionCode, apkSize))) {
      await clearCachedApk(versionCode);
      throw new Error('Скачанный файл повреждён — попробуйте снова');
    }

    writeCachedApkMeta({
      versionCode,
      path,
      url,
      downloadedAt: Date.now(),
    });

    onProgress?.(normalizeProgress({
      phase: 'downloaded',
      loaded: apkSize || null,
      total: apkSize || null,
      percent: 100,
      label: 'Скачивание завершено',
    }));
  } finally {
    await progressListener.remove();
  }
}

export async function installCachedApk(versionCode, onProgress, apkSize = null) {
  if (!isNativeApp()) {
    throw new Error('Обновление APK доступно только в Android-приложении');
  }

  if (!(await validateCachedApk(versionCode, apkSize))) {
    await clearCachedApk(versionCode);
    throw new Error('Файл обновления повреждён — скачайте заново');
  }

  onProgress?.(normalizeProgress({
    phase: 'installing',
    percent: 100,
    label: 'Открываем установщик Android…',
  }));

  await ApkInstaller.install({ versionCode });

  onProgress?.(normalizeProgress({
    phase: 'waiting_install',
    percent: 100,
    label: 'Подтвердите установку в системном окне',
  }));
}

async function nativeDownloadAndInstall({ versionCode, apkUrl }, onProgress) {
  const url = apkUrl || DEFAULT_GITHUB_APK_URL;
  let listener = null;

  try {
    listener = await ApkInstaller.addListener('apkUpdateProgress', (event) => {
      const normalized = normalizeProgress(event);
      if (!normalized.label || normalized.label === 'Скачивание…') {
        normalized.label = buildProgressLabel(normalized.loaded, normalized.total, normalized.percent);
      }
      onProgress?.(normalized);
    });

    await ApkInstaller.downloadAndInstall({ url, versionCode });

    writeCachedApkMeta({
      versionCode,
      url,
      downloadedAt: Date.now(),
    });

    onProgress?.(normalizeProgress({
      phase: 'waiting_install',
      percent: 100,
      label: 'Подтвердите установку в системном окне',
    }));
  } finally {
    await listener?.remove();
  }
}

export async function downloadAndInstallSnabApk({ versionCode, apkSize, apkUrl }, onProgress) {
  if (!isNativeApp()) {
    throw new Error('Обновление APK доступно только в Android-приложении');
  }

  const cached = await hasCachedApk(versionCode, apkSize);
  if (cached) {
    onProgress?.(normalizeProgress({
      phase: 'downloaded',
      percent: 100,
      label: 'Обновление уже скачано — запускаем установку',
    }));
    await installCachedApk(versionCode, onProgress, apkSize);
    return;
  }

  await clearCachedApk(versionCode);

  if (Capacitor.isPluginAvailable('ApkInstaller')) {
    try {
      await nativeDownloadAndInstall({ versionCode, apkUrl }, onProgress);
      return;
    } catch (err) {
      await clearCachedApk(versionCode);
      if (!err?.message?.includes('not implemented')) {
        throw err;
      }
    }
  }

  await downloadApkToCache(versionCode, apkSize, apkUrl, onProgress);
  await installCachedApk(versionCode, onProgress, apkSize);
}

export async function clearCachedApk(versionCode) {
  if (!versionCode) return;
  try {
    await Filesystem.deleteFile({
      path: getCachedApkPath(versionCode),
      directory: Directory.Cache,
    });
  } catch {
    // ignore
  }
  const meta = readCachedApkMeta();
  if (meta?.versionCode === versionCode) {
    try { localStorage.removeItem(CACHED_APK_META_KEY); } catch { /* ignore */ }
  }
}

export async function getSnabAppInfo(api) {
  const info = {
    isNative: isNativeApp(),
    remoteUi: isRemoteCapacitorApp(),
    webBuildId: APP_BUILD_ID,
  };

  if (isNativeApp()) {
    try {
      const appInfo = await App.getInfo();
      info.installedVersion = appInfo.version;
      info.installedBuild = Number(appInfo.build) || 0;
    } catch {
      info.installedVersion = '—';
      info.installedBuild = 0;
    }
  }

  try {
    const server = await api.getSnabUpdateInfo();
    info.serverVersion = server.versionName;
    info.serverBuild = server.versionCode;
    info.apkUrl = server.apkUrl || DEFAULT_GITHUB_APK_URL;
    info.apkSize = server.apkSize || null;
    if (isNativeApp()) {
      const installed = info.installedBuild || 0;
      const serverBuild = Number(server.versionCode) || 0;
      info.updateAvailable = serverBuild > installed;
      info.apkCachedReady = info.updateAvailable
        ? await hasCachedApk(serverBuild, info.apkSize)
        : false;
    }
  } catch {
    /* ignore */
  }

  try {
    const res = await fetch(`${getApiBaseUrl()}/api/app-version`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      info.webVersion = data.version;
      info.webUpdateAvailable = !!data.version && data.version !== APP_BUILD_ID;
    }
  } catch {
    /* ignore */
  }

  return info;
}

export async function checkSnabApkUpdate(api) {
  if (!isNativeApp()) return null;
  const info = await getSnabAppInfo(api);
  if (!info.updateAvailable) return null;
  return {
    versionCode: info.serverBuild,
    versionName: info.serverVersion,
    apkUrl: info.apkUrl,
    apkSize: info.apkSize,
    apkCachedReady: info.apkCachedReady,
    installedVersion: info.installedBuild,
    installedName: info.installedVersion,
  };
}

export { formatBytes };
