import dotenv from 'dotenv';
import db from './db.js';
import { dbPath } from './dbBackup.js';
import * as departments from './departments.js';
import { initPermissions } from './permissions.js';
import { seedDefaultUsers } from './auth.js';
import { initTelegram } from './telegram.js';
import { initWebPush } from './push.js';
import * as svc from './services.js';
import { createApp } from './app.js';
import { setServerReady, setServerInitError } from './readiness.js';

dotenv.config();

const PORT = Number(process.env.PORT) || 3001;
const app = createApp();

async function startBackgroundServices() {
  if (initWebPush()) {
    console.log('🔔 Push-уведомления включены');
  }

  if (process.env.TELEGRAM_ENABLED !== 'false') {
    const dbToken = svc.getSetting('telegram_bot_token');
    const token = dbToken || process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      initTelegram(token).catch((err) => {
        console.error('⚠️  Telegram бот не запущен:', err.message);
      });
    }
  }
}

async function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер слушает порт ${PORT}`);
  });

  try {
    console.log('⏳ Инициализация базы данных...');
    await db.initDb();
    initPermissions(db);
    seedDefaultUsers();
    setServerReady();
    console.log(`✅ База готова: ${dbPath}`);

    try {
      departments.migrateDepartmentStockSync();
    } catch (err) {
      console.error('⚠️ Синхронизация складов пропущена:', err.message);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('👤 Логины: admin/admin123, sklad/sklad123, kassir/kassir123');
    }

    await startBackgroundServices();
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err);
    if (err?.stack) console.error(err.stack);
    setServerInitError(err);
  }
}

start().catch((err) => {
  console.error('Ошибка запуска:', err);
  if (err?.stack) console.error(err.stack);
  setServerInitError(err);
});
