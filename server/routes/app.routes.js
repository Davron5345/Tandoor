import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { requirePermission } from '../middleware.js';
import { getAppVersion } from '../appVersion.js';
import { dataDir } from '../dbBackup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GITHUB_APK_BUILD_URL = 'https://github.com/Davron5345/Tandoor/actions/workflows/android-apk.yml';
const DEFAULT_GITHUB_APK_URL = 'https://github.com/Davron5345/Tandoor/releases/latest/download/snabzenie.apk';

function getSnabApkPath() {
  if (process.env.SNAB_APK_PATH) return process.env.SNAB_APK_PATH;
  const bundled = join(__dirname, '..', '..', 'client', 'dist', 'downloads', 'snabzenie.apk');
  if (existsSync(bundled)) return bundled;
  const publicFile = join(__dirname, '..', '..', 'client', 'public', 'downloads', 'snabzenie.apk');
  if (existsSync(publicFile)) return publicFile;
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

function resolveApkDownloadUrl(req) {
  const base = getPublicBaseUrl(req);
  const apkPath = getSnabApkPath();
  if (existsSync(apkPath)) return `${base}/downloads/snabzenie.apk`;
  return process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL;
}

function sendApkFile(res, apkPath) {
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="snabzenie.apk"');
  return res.sendFile(apkPath);
}

export function registerAppRoutes(app) {
  app.get('/api/public/snab-apk', (req, res) => {
    const apkPath = getSnabApkPath();
    if (existsSync(apkPath)) {
      return sendApkFile(res, apkPath);
    }
    const target = process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL;
    return res.redirect(target);
  });

  app.get('/api/app/snab-install', requirePermission('shop_orders.view'), (req, res) => {
    const base = getPublicBaseUrl(req);
    const apkPath = getSnabApkPath();
    const apkUrl = resolveApkDownloadUrl(req);

    res.json({
      mobileUrl: `${base}/snab`,
      mobilePath: '/snab',
      apkUrl,
      apkDownloadUrl: apkUrl,
      githubApkUrl: process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL,
      apkOnServer: existsSync(apkPath),
      githubBuildUrl: GITHUB_APK_BUILD_URL,
      version: getAppVersion(),
    });
  });

  app.get('/api/app/snab-apk', requirePermission('shop_orders.view'), (req, res) => {
    const apkPath = getSnabApkPath();
    if (!existsSync(apkPath)) {
      return res.redirect(process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL);
    }
    return sendApkFile(res, apkPath);
  });
}
