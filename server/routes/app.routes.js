import { existsSync, createReadStream, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { requirePermission } from '../middleware.js';
import { getAppVersion } from '../appVersion.js';
import { getSnabUpdateInfo } from '../snabAppVersion.js';
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
  return process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL;
}

function sendApkFile(res, apkPath) {
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="snabzenie.apk"');
  return res.sendFile(apkPath);
}

export function registerAppRoutes(app) {
  app.get('/downloads/snabzenie.apk', (req, res) => {
    res.redirect(302, process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL);
  });

  app.get('/api/app/snab-update', async (req, res) => {
    const info = getSnabUpdateInfo(req);
    if (!info.apkSize && info.apkUrl) {
      try {
        const head = await fetch(info.apkUrl, { method: 'HEAD', redirect: 'follow' });
        const len = head.headers.get('content-length');
        if (len) info.apkSize = Number(len);
      } catch {
        /* ignore */
      }
    }
    res.json(info);
  });

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

  app.get('/api/app/snab-apk/stream', requirePermission('shop_orders.view'), async (req, res) => {
    try {
      const apkPath = getSnabApkPath();
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="snabzenie.apk"');

      if (existsSync(apkPath)) {
        const stat = statSync(apkPath);
        res.setHeader('Content-Length', stat.size);
        await pipeline(createReadStream(apkPath), res);
        return;
      }

      const target = process.env.SNAB_APK_URL || DEFAULT_GITHUB_APK_URL;
      const upstream = await fetch(target, { redirect: 'follow' });
      if (!upstream.ok) {
        return res.status(502).json({ error: 'Не удалось получить APK' });
      }
      const len = upstream.headers.get('content-length');
      if (len) res.setHeader('Content-Length', len);
      if (upstream.body) {
        await pipeline(Readable.fromWeb(upstream.body), res);
      } else {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Length', buffer.length);
        res.end(buffer);
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'Ошибка загрузки APK' });
      }
    }
  });
}
