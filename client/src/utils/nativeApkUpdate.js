import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { APP_BUILD_ID } from '../appBuildId';
import { getApiBaseUrl, getNativeSessionToken, isNativeApp, isRemoteCapacitorApp } from './nativeApp';

const ApkInstaller = registerPlugin('ApkInstaller');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Не удалось прочитать файл'));
        return;
      }
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
}

function downloadApkWithProgress(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';

    const token = getNativeSessionToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.withCredentials = true;

    xhr.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress?.({
          phase: 'downloading',
          loaded: event.loaded,
          total: event.total,
          percent,
          label: `Скачивание… ${percent}% (${formatBytes(event.loaded)} / ${formatBytes(event.total)})`,
        });
      } else {
        onProgress?.({
          phase: 'downloading',
          loaded: event.loaded,
          total: null,
          percent: null,
          label: `Скачивание… ${formatBytes(event.loaded)}`,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
        return;
      }
      reject(new Error('Не удалось скачать APK'));
    };
    xhr.onerror = () => reject(new Error('Ошибка сети при скачивании APK'));
    xhr.onabort = () => reject(new Error('Скачивание отменено'));

    onProgress?.({
      phase: 'downloading',
      loaded: 0,
      total: null,
      percent: 0,
      label: 'Подготовка к скачиванию…',
    });
    xhr.send();
  });
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
    installedVersion: info.installedBuild,
    installedName: info.installedVersion,
  };
}

export async function downloadAndInstallSnabApk(_apkUrl, onProgress) {
  if (!isNativeApp()) {
    throw new Error('Обновление APK доступно только в Android-приложении');
  }

  const downloadUrl = `${getApiBaseUrl()}/api/app/snab-apk/stream`;
  const blob = await downloadApkWithProgress(downloadUrl, onProgress);

  onProgress?.({
    phase: 'installing',
    percent: 100,
    label: 'Установка последней версии…',
  });

  const base64 = await blobToBase64(blob);
  const fileName = `snab-update-${Date.now()}.apk`;
  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });

  const { uri } = await Filesystem.getUri({
    path: fileName,
    directory: Directory.Cache,
  });

  await ApkInstaller.install({ uri });

  onProgress?.({
    phase: 'done',
    percent: 100,
    label: 'Подтвердите установку в системном окне',
  });
}

export { formatBytes };
