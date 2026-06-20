import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION_FILE = join(__dirname, '..', 'client', 'dist', 'version.json');

export function getAppVersion() {
  if (existsSync(VERSION_FILE)) {
    try {
      const data = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
      if (data?.version) return { version: String(data.version), builtAt: data.builtAt || null };
    } catch {
      /* fall through */
    }
  }

  const fallback = process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.GITHUB_SHA
    || process.env.APP_BUILD_ID
    || 'dev';

  return { version: String(fallback), builtAt: null };
}
