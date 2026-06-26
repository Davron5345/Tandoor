import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { APP_BUILD_ID } from '../appBuildId';
import { getApiBaseUrl, getNativeSessionToken, isNativeApp, isRemoteCapacitorApp } from './nativeApp';

const ApkInstaller = registerPlugin('ApkInstaller');
const CACHED_APK_META_KEY = 'snab-apk-cache-meta';

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

export async function hasCachedApk(versionCode, apkSize = null) {
  if (!isNativeApp() || !versionCode) return false;
  const meta = readCachedApkMeta();
  if (meta?.versionCode !== versionCode) return false;
  try {
    const stat = await Filesystem.stat({
      path: getCachedApkPath(versionCode),
      directory: Directory.Cache,
    });
    const size = stat.size || 0;
    if (apkSize) return size >= apkSize * 0.95;
    return size > 5 * 1024 * 1024;
  } catch {
    return false;
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

export async function downloadApkToCache(versionCode, apkSize, onProgress) {
  if (!isNativeApp()) {
    throw new Error('Обновление APK доступно только в Android-приложении');
  }

  const downloadUrl = `${getApiBaseUrl()}/api/app/snab-apk/stream`;
  const path = getCachedApkPath(versionCode);
  const token = getNativeSessionToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const progressListener = await Filesystem.addListener('progress', (event) => {
    const loaded = Number(event.bytes) || 0;
    const total = Number(event.contentLength) || apkSize || null;
    const percent = total
      ? Math.min(99, Math.round((loaded / total) * 100))
      : (loaded > 0 ? null : 0);
    onProgress?.({
      phase: 'downloading',
      loaded,
      total,
      percent,
      label: buildProgressLabel(loaded, total, percent),
    });
  });

  onProgress?.({
    phase: 'downloading',
    loaded: 0,
    total: apkSize || null,
    percent: 0,
    label: 'Подключение к серверу…',
  });

  try {
    await Filesystem.downloadFile({
      url: downloadUrl,
      path,
      directory: Directory.Cache,
      progress: true,
      headers,
    });

    writeCachedApkMeta({
      versionCode,
      path,
      downloadedAt: Date.now(),
    });

    onProgress?.({
      phase: 'downloaded',
      loaded: apkSize || null,
      total: apkSize || null,
      percent: 100,
      label: 'Скачивание завершено',
    });
  } finally {
    await progressListener.remove();
  }
}

export async function installCachedApk(versionCode, onProgress, apkSize = null) {
  if (!isNativeApp()) {
    throw new Error('Обновление APK доступно только в Android-приложении');
  }

  const cached = await hasCachedApk(versionCode, apkSize);
  if (!cached) {
    throw new Error('Файл обновления не найден — скачайте заново');
  }

  onProgress?.({
    phase: 'installing',
    percent: 100,
    label: 'Открываем установщик Android…',
  });

  const { uri } = await Filesystem.getUri({
    path: getCachedApkPath(versionCode),
    directory: Directory.Cache,
  });

  await ApkInstaller.install({ uri });

  onProgress?.({
    phase: 'waiting_install',
    percent: 100,
    label: 'Подтвердите установку в системном окне',
  });
}

export async function downloadAndInstallSnabApk({ versionCode, apkSize }, onProgress) {
  const cached = await hasCachedApk(versionCode, apkSize);
  if (!cached) {
    await downloadApkToCache(versionCode, apkSize, onProgress);
  } else {
    onProgress?.({
      phase: 'downloaded',
      percent: 100,
      label: 'Обновление уже скачано — запускаем установку',
    });
  }
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
    info.apkUrl = server.apkUrl;
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
