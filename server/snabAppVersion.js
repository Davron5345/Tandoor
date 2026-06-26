import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { statSync } from 'fs';
import { dataDir } from './dbBackup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getSnabApkPath() {
  if (process.env.SNAB_APK_PATH) return process.env.SNAB_APK_PATH;
  const bundled = join(__dirname, '..', 'client', 'dist', 'downloads', 'snabzenie.apk');
  if (existsSync(bundled)) return bundled;
  const publicFile = join(__dirname, '..', 'client', 'public', 'downloads', 'snabzenie.apk');
  if (existsSync(publicFile)) return publicFile;
  return join(dataDir, 'snab.apk');
}

function readVersionMeta() {
  const versionFile = join(__dirname, '..', 'android', 'app-version.json');
  if (!existsSync(versionFile)) {
    return { versionCode: 1, versionName: '1.0.0' };
  }
  try {
    const data = JSON.parse(readFileSync(versionFile, 'utf8'));
    return {
      versionCode: Number(data.versionCode) || 1,
      versionName: String(data.versionName || '1.0.0'),
    };
  } catch {
    return { versionCode: 1, versionName: '1.0.0' };
  }
}

export function getSnabUpdateInfo(req) {
  const { versionCode, versionName } = readVersionMeta();
  const apkPath = getSnabApkPath();
  const apkOnServer = existsSync(apkPath);
  const proto = req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https';
  const host = req?.headers?.['x-forwarded-host'] || req?.get?.('host');
  const base = process.env.APP_PUBLIC_URL?.replace(/\/$/, '')
    || (host ? `${proto}://${host}` : '');

  let apkUrl = process.env.SNAB_APK_URL
    || 'https://github.com/Davron5345/Tandoor/releases/latest/download/snabzenie.apk';

  let apkSha256 = null;
  let apkSize = null;
  if (apkOnServer) {
    const buffer = readFileSync(apkPath);
    apkSha256 = createHash('sha256').update(buffer).digest('hex');
    apkSize = statSync(apkPath).size;
  }

  return {
    versionCode,
    versionName,
    apkUrl,
    apkOnServer,
    apkSha256,
    apkSize,
    webAutoUpdate: true,
    message: 'Приложение загружает интерфейс с сервера — обновления UI без переустановки APK. Новый APK нужен только при смене versionCode.',
  };
}
