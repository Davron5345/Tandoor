import { existsSync } from 'fs';
import { join } from 'path';
import { requirePermission } from '../middleware.js';
import { getAppVersion } from '../appVersion.js';
import { dataDir } from '../dbBackup.js';

const GITHUB_APK_BUILD_URL = 'https://github.com/Davron5345/Tandoor/actions/workflows/android-apk.yml';

function getSnabApkPath() {
  if (process.env.SNAB_APK_PATH) return process.env.SNAB_APK_PATH;
  return join(dataDir, 'snab.apk');
}

function getPublicBaseUrl(req) {
  if (process.env.APP_PUBLIC_URL) {
    return process.env.APP_PUBLIC_URL.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

export function registerAppRoutes(app) {
  app.get('/api/app/snab-install', requirePermission('shop_orders.view'), (req, res) => {
    const base = getPublicBaseUrl(req);
    const apkPath = getSnabApkPath();
    const apkOnDisk = existsSync(apkPath);

    res.json({
      mobileUrl: `${base}/snab`,
      mobilePath: '/snab',
      apkUrl: apkOnDisk ? `${base}/api/app/snab-apk` : (process.env.SNAB_APK_URL || null),
      apkOnServer: apkOnDisk,
      githubBuildUrl: GITHUB_APK_BUILD_URL,
      version: getAppVersion(),
    });
  });

  app.get('/api/app/snab-apk', requirePermission('shop_orders.view'), (req, res) => {
    const apkPath = getSnabApkPath();
    if (!existsSync(apkPath)) {
      return res.status(404).json({
        error: 'APK не загружен на сервер. Соберите в GitHub Actions или укажите SNAB_APK_URL.',
        githubBuildUrl: GITHUB_APK_BUILD_URL,
      });
    }
    res.download(apkPath, 'snabzenie.apk');
  });
}
