import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as productImages from './productImages.js';
import { createCorsOptions } from './corsConfig.js';
import { authRequired } from './middleware.js';
import { registerApiRoutes } from './routes/index.js';
import { createProtectedUploadsRouter } from './uploadsMiddleware.js';
import { isServerReady, getServerInitError } from './readiness.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createProductImageUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        try {
          cb(null, productImages.ensureProductDir(req.params.id));
        } catch (e) {
          cb(e);
        }
      },
      filename: (_req, file, cb) => {
        const ext = productImages.extFromMime(file.mimetype) || '';
        cb(null, `${uuidv4()}${ext}`);
      },
    }),
    limits: { fileSize: productImages.MAX_FILE_SIZE },
    fileFilter: (_req, file, cb) => {
      if (productImages.isAllowedMime(file.mimetype)) cb(null, true);
      else cb(new Error('Допустимы JPG, PNG, WEBP и GIF'));
    },
  });
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfOriginCheck(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  const publicUrl = process.env.APP_PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!publicUrl) return next(); // dev / no config — skip
  const origin = req.headers.origin || req.headers.referer || '';
  const host = publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!origin || origin.includes(host)) return next();
  // Native app bearer-token requests are not CSRF-vulnerable
  if (req.headers['x-native-client'] === '1') return next();
  return res.status(403).json({ error: 'CSRF: недопустимый источник запроса' });
}

export function createApp() {
  const app = express();

  app.use(cors(createCorsOptions()));
  app.use(express.json());
  app.use(csrfOriginCheck);

  app.use((req, res, next) => {
    if (!isServerReady() && req.path.startsWith('/api') && req.path !== '/api/health') {
      const initError = getServerInitError();
      return res.status(503).json({
        error: initError || 'Сервер запускается, подождите несколько секунд',
      });
    }
    next();
  });

  app.use('/uploads', createProtectedUploadsRouter());

  const productImageUpload = createProductImageUpload();
  registerApiRoutes(app, { authRequired, productImageUpload });

  // Centralized error handler: map known patterns to correct HTTP status codes
  app.use((err, req, res, _next) => {
    if (res.headersSent) return;
    const msg = err?.message || String(err);
    const notFound = /не найден|not found/i.test(msg);
    const conflict = /уже занят|уже существует|нельзя удалить|используется/i.test(msg);
    const forbidden = /недостаточно прав|только администратор|нельзя изменить|нельзя привязать/i.test(msg);
    const status = notFound ? 404 : conflict ? 409 : forbidden ? 403 : 400;
    res.status(status).json({ error: msg });
  });

  const clientDist = join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.apk')) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', 'attachment; filename="snabzenie.apk"');
      }
    },
  }));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).send('Frontend not built. Run: npm run build');
    });
  });

  return app;
}
