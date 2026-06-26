import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { APP_BUILD_ID } from '../appBuildId';
import { getApiBaseUrl, isNativeApp, isRemoteCapacitorApp } from './nativeApp';

const ApkInstaller = registerPlugin('ApkInstaller');

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
    if (isNativeApp()) {
      info.updateAvailable = server.versionCode > (info.installedBuild || 0);
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
  if (info.updateAvailable) {
    return {
      versionCode: info.serverBuild,
      versionName: info.serverVersion,
      apkUrl: info.apkUrl,
      installedVersion: info.installedBuild,
      installedName: info.installedVersion,
    };
  }
  return null;
}

export async function downloadAndInstallSnabApk(apkUrl) {
  if (!isNativeApp()) {
    throw new Error('Обновление APK доступно только в Android-приложении');
  }

  const response = await CapacitorHttp.get({
    url: apkUrl,
    responseType: 'blob',
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error('Не удалось скачать APK');
  }

  const fileName = `snab-update-${Date.now()}.apk`;
  await Filesystem.writeFile({
    path: fileName,
    data: response.data,
    directory: Directory.Cache,
  });

  const { uri } = await Filesystem.getUri({
    path: fileName,
    directory: Directory.Cache,
  });

  await ApkInstaller.install({ uri });
}
