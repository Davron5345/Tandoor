/**
 * Playwright поднимает webServer ДО globalSetup.
 * Поэтому сид БД должен выполняться в том же процессе/команде до listen(),
 * иначе сервер держит пустую sql.js-БД в памяти, а сид пишет другой файл на диск.
 */
import { prepareE2eDatabase } from './seed.mjs';

await prepareE2eDatabase();
await import('../server/index.js');
