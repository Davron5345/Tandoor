import { existsSync } from 'fs';
import { join } from 'path';
import { requirePermission } from '../middleware.js';
import { getAppVersion } from '../appVersion.js';
import { dataDir } from '../dbBackup.js';

const GITHUB_APK_BUILD_URL = 'https://github.com/Davron5345/Tandoor/actions/workflows/android-apk.yml';
const DEFAULT_GITHUB_APK_URL = 'https://github.com/Davron5345/Tandoor/releases/latest/download/snabzenie.apk';

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

function resolveApkDownloadUrl(req, apkOnDisk) {
  const base = getPublicBaseUrl(req);
  if (apkOnDisk) return `${base}/api/public/snab-apk`;
  return process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL;
}

export function registerAppRoutes(app) {
  app.get('/api/public/snab-apk', (req, res) => {
    const apkPath = getSnabApkPath();
    if (existsSync(apkPath)) {
      return res.download(apkPath, 'snabzenie.apk');
    }
    const target = process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL;
    return res.redirect(target);
  });

  app.get('/api/app/snab-install', requirePermission('shop_orders.view'), (req, res) => {
    const base = getPublicBaseUrl(req);
    const apkPath = getSnabApkPath();
    const apkOnDisk = existsSync(apkPath);
    const apkUrl = resolveApkDownloadUrl(req, apkOnDisk);

    res.json({
      mobileUrl: `${base}/snab`,
      mobilePath: '/snab',
      apkUrl,
      apkDownloadUrl: apkUrl,
      apkOnServer: apkOnDisk,
      githubBuildUrl: GITHUB_APK_BUILD_URL,
      version: getAppVersion(),
    });
  });

  app.get('/api/app/snab-apk', requirePermission('shop_orders.view'), (req, res) => {
    const apkPath = getSnabApkPath();
    if (!existsSync(apkPath)) {
      return res.redirect(process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL);
    }
    res.download(apkPath, 'snabzenie.apk');
  });
}
