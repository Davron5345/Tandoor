import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function appVersionPlugin() {
  const buildId = process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.GITHUB_SHA
    || String(Date.now());

  return {
    name: 'app-version',
    config() {
      return {
        define: {
          __APP_BUILD_ID__: JSON.stringify(buildId),
        },
      };
    },
    closeBundle() {
      const payload = {
        version: buildId,
        builtAt: new Date().toISOString(),
      };
      writeFileSync(
        resolve(__dirname, 'dist', 'version.json'),
        `${JSON.stringify(payload, null, 2)}\n`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), appVersionPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
