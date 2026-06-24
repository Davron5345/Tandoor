import { registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { isNativeApp } from './nativeApp';

const ApkInstaller = registerPlugin('ApkInstaller');

export async function checkSnabApkUpdate(api) {
  if (!isNativeApp()) return null;
  const [info, appInfo] = await Promise.all([
    api.getSnabUpdateInfo(),
    App.getInfo(),
  ]);
  const installed = Number(appInfo.build) || 0;
  if (info.versionCode > installed) {
    return { ...info, installedVersion: installed, installedName: appInfo.version };
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
