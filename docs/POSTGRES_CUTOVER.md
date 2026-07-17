# Postgres cutover (SQLite → Railway Postgres)

## Цель

Перевести Tandoor с `sql.js` / `data/warehouse.db` на Railway PostgreSQL **без потери данных**.
Загрузки (`uploads/`) остаются на volume `/data`.

## Поведение кода

| `DATABASE_URL` | Движок |
|----------------|--------|
| задан (`postgres://…`) | Postgres (`pg`) |
| `pglite` / `DB_ENGINE=pglite` | PGlite (локальные тесты) |
| не задан | sql.js + `warehouse.db` (откат) |

На проде после cutover всегда задавайте `DATABASE_URL`. Откат = предыдущий деплой **без** `DATABASE_URL` + volume с `warehouse.db`.

## 1. Railway: добавить Postgres

В проекте Railway (сервис приложения Tandoor):

```bash
# Если CLI привязан к проекту:
railway link
railway add --database postgres
# Затем в Variables сервиса приложения:
# DATABASE_URL=${{Postgres.DATABASE_URL}}
# DATA_DIR=/data   (или mount path volume)
# DISABLE_DEMO_SEED=true
# NODE_ENV=production
```

Через UI: **New → Database → PostgreSQL**, затем Reference `DATABASE_URL` в сервис приложения.

Volume `/data` оставить для `uploads/` (+ временно `warehouse.db` как rollback).

`railway.toml` не хранит секреты; переменные задаются в Railway Variables.

## 2. Подготовка кода (уже в репозитории)

- Адаптер: `server/pgAdapter.js` + `server/pgWorker.mjs` + `server/sqlTranslate.js`
- Схема: `server/pgSchema.js`
- Импорт: `npm run db:migrate-pg`
- Health: `/api/health` проверяет Postgres, если `DATABASE_URL` задан

## 3. Maintenance cutover (15–30 мин)

1. Объявить short maintenance / остановить запись (или scale to 0).
2. Скачать актуальный `warehouse.db`:
   - админ-бэкап из UI, или
   - `railway run` / volume download, или
   - `npm run db:backup` на старом инстансе.
3. Импорт в Postgres (с машины с доступом к `DATABASE_URL`):

```bash
export DATABASE_URL='postgres://…'   # из Railway
export MIGRATE_TRUNCATE=true         # чистый импорт
npm run db:migrate-pg -- ./path/to/warehouse.db
```

Скрипт создаёт схему, копирует таблицы, сверяет `COUNT(*)` и печатает контрольные суммы
(confirmed-документы, сумма платежей, сумма остатков, пользователи).
Во время импорта включается `session_replication_role=replica` (SQLite часто хранит
orphan-строки без FK). При необходимости перед импортом почистите локальную копию
`warehouse.db` от ссылок на удалённые филиалы/документы. `settings` в PG может быть
на 1+ больше (ключи схемы миграции) — это нормально (`[OK~]`).

4. Убедиться, что все `[OK]`/`[OK~]` и checksums совпали.
5. В Railway Variables приложения выставить `DATABASE_URL` (reference) + `DISABLE_DEMO_SEED=true`.
6. Задеплоить новую версию кода.
7. Smoke:
   - `GET /api/health` → `ok: true`, `database.engine: postgresql`, `database.ok: true`
   - логин admin
   - список документов / остатки
   - провести тестовый draft и отменить

## 4. Откат

1. Убрать `DATABASE_URL` из Variables (или откатить деплой на релиз до Postgres).
2. Убедиться, что volume с `warehouse.db` на месте (`DATA_DIR`).
3. Redeploy — приложение снова на sql.js.

Данные Postgres при откате не трогаются; `warehouse.db` на volume не удалять 1–2 недели.

## 5. Локальные тесты на Postgres (PGlite)

Без Docker:

```bash
DATABASE_URL=pglite DB_ENGINE=pglite DISABLE_DEMO_SEED=true npm test
```

Или против реального Postgres:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/tandoor npm test
```

## 6. Что не мигрируем

- Файлы в `data/uploads/` — остаются на volume
- Distibution / UI / Capacitor — без изменений в этой миграции
