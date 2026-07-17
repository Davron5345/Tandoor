# Учёт прихода и расхода товаров

Веб-приложение для складского учёта с историей документов и интеграцией Telegram.

## Возможности

- **Приход и расход** — создание документов с позициями товаров
- **Склад** — автоматический пересчёт остатков при проведении
- **Контрагенты** — поставщики и клиенты с контактами
- **История изменений** — каждое создание, редактирование, проведение и отмена документа сохраняется
- **Telegram бот** — автоматические уведомления и ручная отправка сообщений

## Быстрый старт

```bash
# 1. Установка зависимостей
npm run setup

# 2. Настройка Telegram (опционально)
copy .env.example .env
# Укажите TELEGRAM_BOT_TOKEN от @BotFather

# 3. Запуск в режиме разработки
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Продакшен

```bash
npm run build
npm start
```

Приложение будет доступно на http://localhost:3001

### Деплой без потери данных

База — файл `warehouse.db` в папке `data/`. Эта папка **не попадает в git** (`.gitignore`), поэтому при каждом деплое «с нуля» (Docker без тома, облако с эфемерным диском) создаётся **пустая** база.

**Что сделать на сервере:**

1. Смонтировать **постоянный том** в папку данных, например `/var/lib/prihod-rashod/data`.
2. В `.env` указать:
   ```
   NODE_ENV=production
   DATA_DIR=/var/lib/prihod-rashod/data
   ```
3. Один раз скопировать туда `warehouse.db` и `backups/` с рабочей машины **или** восстановить: `npm run db:restore -- best`.

**Docker (пример):**
```yaml
volumes:
  - prihod-data:/var/lib/prihod-rashod/data
environment:
  - NODE_ENV=production
  - DATA_DIR=/var/lib/prihod-rashod/data
```

При `NODE_ENV=production` демо-товары не подставляются в пустую базу — вы сразу увидите предупреждение в логах, а не «чужие» данные.

## Настройка Telegram

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Скопируйте токен в `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
   TELEGRAM_ENABLED=true
   ```
3. Контрагент пишет боту `/start` — бот пришлёт Chat ID
4. Укажите Chat ID в карточке контрагента
5. При проведении документа уведомление отправится автоматически

## База данных

**Продакшен (рекомендуется):** PostgreSQL через `DATABASE_URL` (Railway Postgres).  
**Локально / откат:** SQLite-файл `data/warehouse.db` (sql.js), если `DATABASE_URL` не задан.

Uploads всегда на файловой системе: `DATA_DIR/uploads` (volume).

Миграция SQLite → Postgres: [docs/POSTGRES_CUTOVER.md](docs/POSTGRES_CUTOVER.md)

| Команда | Описание |
|---------|----------|
| `npm run db:list-backups` | Показать копии SQLite и сколько в них записей |
| `npm run db:restore -- best` | Восстановить самую полную копию SQLite |
| `npm run db:backup` | Создать копию SQLite вручную |
| `npm run db:migrate-pg` | Импорт `warehouse.db` → Postgres |
| `npm run test:pg` | Backend-тесты на PGlite (Postgres-диалект) |


**Почему данные могут пропасть:**
- деплой без постоянного тома (`data/` не в git, диск контейнера сбрасывается);
- не задан `DATA_DIR` на внешний диск;
- случайный сброс через API администратора (`/api/admin/reset-test-data`);
- удаление или замена файла `data/warehouse.db`;
- восстановление пустой копии вместо рабочей;
- запуск второй копии проекта с другой папкой `data/`.

**После восстановления** перезапустите сервер (`npm run dev`) и перезайдите в приложение.

## Структура

```
server/          — Express API + SQLite + Telegram бот
client/          — React интерфейс
data/            — база данных (создаётся автоматически)
```

## API

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/products | Список товаров |
| GET | /api/counterparties | Контрагенты |
| GET | /api/documents | Документы |
| POST | /api/documents | Создать документ |
| GET | /api/documents/:id/history | История изменений |
| POST | /api/documents/:id/confirm | Провести документ |
| POST | /api/telegram/send | Отправить сообщение |
