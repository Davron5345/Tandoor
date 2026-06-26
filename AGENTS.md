# Документация системы для ИИ-агента

> **Прочитай этот файл целиком перед любыми изменениями.** Не исследуй проект с нуля — здесь описана вся архитектура, бизнес-логика и соглашения.
>
> **При любом изменении кода обязательно обнови соответствующий раздел этого файла** (см. правило `.cursor/rules/update-agent-docs.mdc`).

**Последнее обновление документации:** 2026-06-26

---

## 1. Назначение системы

**Приход расход** (`prihod-rashod`) — русскоязычное веб-приложение складского и финансового учёта для ресторанного/ритейл-бизнеса (сеть «Mahalla»).

Основные возможности:

| Область | Что делает |
|---------|-----------|
| Склад | Приход, расход, перемещение, возвраты поставщику/клиенту |
| Производство | Разделка, калькуляции (рецептуры), продажа блюд со списанием ингредиентов |
| Справочники | Номенклатура (4 вида товаров), категории, единицы, контрагенты, договоры |
| Финансы | Касса, банк/оплаты, статьи кассы, P&L, начальное сальдо |
| MyShop | Онлайн-витрина для сотрудников, заявки на продукты, конструктор витрины |
| Администрирование | Филиалы, отделы, роли/права, сотрудники, аудит, безопасность |
| Интеграции | Telegram-бот, Web Push (браузер/PWA), FCM Push (Android APK), приложение снабженца |

---

## 2. Технологический стек

| Слой | Технологии |
|------|-----------|
| Backend | Node.js ≥20, Express 4, ESM (`"type": "module"`), sql.js (SQLite в файле) |
| Frontend | React 18, Vite, React Router 7, plain CSS (без UI-фреймворка) |
| Mobile | Capacitor 7 (Android), PWA service worker, TypeScript для `capacitor.config.ts` |
| Тесты | Node test runner (`server/test/`), Playwright E2E (`e2e/`), ESLint |
| Хранение | `data/warehouse.db`, `data/backups/`, `data/uploads/` |

**Продакшен:** один процесс Express отдаёт API + статику `client/dist` на одном порту.

---

## 3. Структура проекта

```
prihod-rashod/
├── server/                 # Backend
│   ├── index.js            # Точка входа: env, DB init, permissions, Telegram, push
│   ├── app.js              # Express: CORS, middleware, маршруты, static dist
│   ├── db.js               # SQLite schema + миграции (встроенные, order-sensitive!)
│   ├── auth.js             # Пользователи, хеширование паролей (scrypt)
│   ├── sessions.js         # Сессии, cookie, bearer token для native
│   ├── permissions.js      # Роли, права, пресеты (источник истины для backend)
│   ├── middleware.js       # requireAuth, requirePermission, branch context
│   ├── routes/             # Тонкие HTTP-маршруты (делегируют в services/)
│   ├── services/           # Бизнес-логика: documents, products, payments, reports...
│   ├── inventoryCost.js    # Средневзвешенная себестоимость, движение по отделам
│   ├── calculations.js     # Калькуляции/рецептуры
│   ├── dishSales.js        # Продажа блюд: план списания ингредиентов
│   ├── productKinds.js     # Виды товаров и допустимые роли в документах
│   ├── branches.js         # Филиалы, branch stock
│   ├── departments.js      # Отделы/склады внутри филиала
│   ├── myShop.js           # Витрина MyShop, layout
│   ├── shopOrders.js       # Заявки MyShop
│   ├── telegram.js         # Telegram-бот
│   ├── push.js             # Push: Web Push (VAPID) + FCM (Android native)
│   ├── snabAppVersion.js   # Метаданные APK, URL скачивания
│   ├── staffLocation.js    # Геолокация снабженцев
│   └── test/               # Unit/integration тесты backend
├── client/
│   ├── src/
│   │   ├── main.jsx        # Роутинг: публичный shop, mobile snab, основное приложение
│   │   ├── App.jsx         # Layout, sidebar, навигация по правам
│   │   ├── api.js          # Единый API-клиент (все fetch-вызовы)
│   │   ├── permissions.js  # Проверка прав на frontend (зеркало backend)
│   │   ├── AuthContext.jsx # Сессия пользователя
│   │   ├── BranchContext.jsx # Активный филиал
│   │   ├── pages/          # Страницы приложения
│   │   ├── components/     # Переиспользуемые компоненты
│   │   ├── hooks/          # React-хуки
│   │   ├── utils/          # nativeApp, nativePush, nativeApkUpdate, pwaPush, date...
│   │   └── components/     # SnabProfileView, SnabAppPanel, AdminPushTab (в pages/)...
│   └── public/             # Статика, PWA; APK — зеркало на GitHub Releases
├── android/                # Capacitor Android (com.tandoor.snab)
│   ├── app/google-services.json   # Firebase (не в git — секрет CI / локально)
│   └── app-version.json    # versionCode/versionName для API
├── capacitor.config.ts     # Capacitor; CAPACITOR_SERVER_URL при сборке APK
├── e2e/                    # Playwright тесты
├── scripts/                # Сборка Android, иконки
├── docs/                   # Доп. документация (SNAB_ANDROID.md)
├── data/                   # БД и uploads (НЕ в git!)
├── AGENTS.md               # ← ЭТОТ ФАЙЛ
└── .cursor/rules/          # Правила для Cursor AI
```

---

## 4. Запуск и команды

```bash
npm run setup          # Установка зависимостей (root + client)
npm run dev            # Dev: backend :3001 + Vite :5173
npm run build          # Сборка frontend → client/dist
npm start              # Продакшен (после build)
npm test               # Backend тесты
npm run test:e2e       # Playwright E2E
npm run lint           # ESLint
```

**База данных:**

```bash
npm run db:backup              # Ручной бэкап
npm run db:list-backups          # Список бэкапов
npm run db:restore -- best       # Восстановить лучший бэкап
npm run db:reset-operations      # Сброс операционных данных
```

**Dev-логины** (только `NODE_ENV !== production`):
- `admin` / `admin123`
- `sklad` / `sklad123`
- `kassir` / `kassir123`

---

## 5. Backend: архитектура

### 5.1 Поток запуска

`server/index.js` → `createApp()` → `db.initDb()` → `initPermissions()` → `seedDefaultUsers()` → `departments.migrateDepartmentStockSync()` → Telegram/Push.

### 5.2 Паттерн маршрутов

- `server/routes/*.routes.js` — регистрация HTTP, валидация входа, вызов `services/*`
- `server/services/*.js` — бизнес-логика, транзакции БД
- `server/routes/index.js` — агрегатор всех маршрутов

### 5.3 База данных

- **Движок:** sql.js (SQLite в памяти, периодически сбрасывается на диск)
- **Файл:** `data/warehouse.db` (путь через `DATA_DIR` env)
- **Миграции:** встроены в `server/db.js`, отслеживаются ключами в таблице `settings`
- **Бэкапы:** автоматически при старте и перед миграциями → `data/backups/` (до 30 шт.)
- **Запись:** атомарная через `writeDatabaseAtomic()` в `dbBackup.js`
- **Транзакции:** `db.transaction(fn)` — BEGIN/COMMIT/ROLLBACK

> ⚠️ Нет отдельного migration framework. Изменения схемы добавляются в `db.js` с проверкой `settings` key. Порядок важен!

### 5.4 Таблицы БД (основные)

| Группа | Таблицы |
|--------|---------|
| Каталог | `products`, `product_variants`, `product_categories`, `units`, `product_images`, `product_suppliers`, `product_branches`, `product_variant_branches` |
| Склад | `departments`, `product_department_stock`, `product_branch_stock` |
| Документы | `documents`, `document_items`, `document_history`, `opening_balance_lines` |
| Контрагенты | `counterparties`, `counterparty_contracts` |
| Финансы | `payments`, `cash_articles`, `branch_opening_balances` |
| Калькуляции | `calculations`, `calculation_items`, `calculation_sources` |
| Auth/Admin | `users`, `sessions`, `roles`, `role_permissions`, `audit_log`, `visit_log`, `blocked_devices` |
| MyShop/Mobile | `shop_orders`, `shop_order_items`, `push_subscriptions`, `staff_locations`, `staff_location_history` |
| Прочее | `telegram_messages`, `settings`, `branches` |

---

## 6. Frontend: архитектура

### 6.1 Роутинг (`client/src/main.jsx`)

| Путь | Компонент | Auth |
|------|-----------|------|
| `/shop/:branchId` | `PublicShop` | Нет |
| `/shop/:branchId/dept/:departmentId` | `PublicShop` | Нет |
| `/warehouse/orders`, `/snab` | `ShopOrdersMobile` | Да (mobile snab) |
| `/*` | `App` (основное приложение) | Да |

### 6.2 Контексты

- `AuthContext` — текущий пользователь, login/logout, `must_change_password`
- `BranchContext` — список филиалов, активный `branchId` (admin может переключать)
- `ThemeContext` — светлая/тёмная тема

### 6.3 API-клиент (`client/src/api.js`)

- Все HTTP-запросы через объект `api`
- Автоматически добавляет `branch_id` query param через `setActiveBranchId()`
- Native app: Bearer token из `getNativeSessionToken()`, заголовок `X-Native-Client: 1`
- Cookie-based сессия: `credentials: 'include'`

### 6.4 Навигация и права (`App.jsx`)

Sidebar строится динамически по `hasPermission()`. Разделы: Закупки, Продажи, Справочники, Деньги, Производство, Отчёты, Администрирование.

**Упрощённый UI кассира:** `isCashierOnlyLayout()` — без sidebar, только `/cashier`.

---

## 7. Аутентификация и авторизация

### 7.1 Сессии

- Cookie: `warehouse_session` (HttpOnly)
- Native: Bearer token в ответе `/api/auth/login`
- Срок: 12 часов (или 7 дней с `remember`)
- Пароли: `crypto.scryptSync`
- Production admin: принудительный `must_change_password`

### 7.2 Роли (встроенные)

| Роль | Описание |
|------|----------|
| `admin` | Полный доступ (`*` permissions) |
| `warehouse` | Склад, документы, MyShop, калькуляции |
| `cashier` | Касса за смену |
| `accountant` | Касса, оплаты, отчёты, прошлые даты |

Кастомные роли создаются per-branch (клонирование с префиксом `cashier_<branchId>` и т.д.).

### 7.3 Ключевые permission keys

```
dashboard.view
products.view / products.edit
counterparties.view / counterparties.edit
calculations.view / calculations.edit
documents.prihod / documents.rashod / documents.transfer / documents.razdelka / documents.dish_sale
documents.view / documents.edit / documents.confirm / documents.delete
cashier.view / cashier.edit / cashier.delete / cashier.edit_past
payments.view / payments.edit / payments.delete / payments.edit_past
cash_articles.view / cash_articles.edit
reports.view
opening_balance.view / opening_balance.edit
myshop.view / myshop.edit
shop_orders.view / shop_orders.edit
telegram.view / telegram.settings / telegram.send
users.view / users.edit
branches.view / branches.edit
```

Источник истины: `server/permissions.js` (PERMISSION_GROUPS, DEFAULT_ROLE_PERMISSIONS).
Frontend зеркало: `client/src/permissions.js`.

### 7.4 Ограничения по датам

- Кассир видит последние 3 дня (`CASHIER_VIEW_DAYS = 3`)
- Операции за прошлые даты: только с `cashier.edit_past` / `payments.edit_past`

---

## 8. Мультифилиальность

- **Не мультитенантность**, а **branch-scoped** данные
- `branch_id` передаётся: query param или заголовок `X-Branch-Id`
- Admin на `main` филиале видит все филиалы
- Обычный пользователь привязан к `user.branch_id`
- Отделы (`departments`) принадлежат филиалу
- Остатки ведутся на уровне **отдела** (`product_department_stock`), агрегируются в branch stock

---

## 9. Бизнес-логика

### 9.1 Виды товаров (`productKinds.js`)

| kind | Русское | Использование |
|------|---------|---------------|
| `goods` | Товар | Розница, разделка (выход) |
| `raw` | Сырьё | Ингредиенты, MyShop |
| `semi_finished` | Полуфабрикат | Ингредиенты, разделка (выход), MyShop |
| `dish` | Готовое блюдо | Продажа блюд |

### 9.2 Типы документов

| type | Русское | Направление |
|------|---------|-------------|
| `prihod` | Приход | +остаток (от поставщика) |
| `rashod` | Расход | −остаток (клиенту) |
| `return_supplier` | Возврат поставщику | −остаток, привязка к prihod |
| `return_customer` | Возврат от клиента | +остаток по себестоимости, привязка к rashod |
| `peremeshchenie` | Перемещение | между отделами или филиалами |
| `razdelka` | Разделка | −вход, +выход по калькуляции |
| `dish_sale` | Продажа блюд | −ингредиенты, +выручка в P&L |
| `opening_balance` | Начальное сальдо | стартовые остатки/долги/касса |

### 9.3 Статусы документов

`draft` → `confirmed` (проведение, движение остатков) → `cancelled` (отмена, обратное движение).

Каждое действие сохраняется в `document_history` (snapshot JSON).

### 9.4 Себестоимость (`inventoryCost.js`)

- **Средневзвешенная** (`avg_cost`) в `product_department_stock`
- Приход: `receiveDepartmentStock()` — пересчёт avg
- Расход: `issueDepartmentStock()` — списание по avg_cost
- Перемещение: `transferDepartmentStock()` — cost следует за товаром

### 9.5 Калькуляции

- Рецептура: входные позиции (`calculation_items`) + выход (`calculation_sources`)
- `POST /api/calculations/:id/apply` — применить к разделке
- Продажа блюд: `buildDishSalePlan()` → видимые строки продажи + скрытые строки списания ингредиентов

### 9.6 P&L (`services/reports.js`)

- Выручка: confirmed `rashod` + `dish_sale` − возвраты
- COGS: сумма `cost_amount` по строкам документов
- Прочие доходы/расходы: кассовые операции

### 9.7 MyShop

- Публичная витрина: `/shop/:branchId` (без auth)
- Заявки сотрудников: `shop_orders` → статусы → опционально генерация документа
- Конструктор layout: `GET/PUT /api/myshop/layout`

### 9.8 Начальное сальдо

Типы строк: stock, debtor, creditor, cash, bank. Документ `opening_balance` + `opening_balance_lines`.

---

## 10. API (сводка)

Полная спецификация: `GET /api/openapi.json` и `GET /api/docs`.

### Публичные (без auth)

```
GET  /api/health
GET  /api/app-version
GET  /api/public/shop/:branchId/catalog
POST /api/public/shop/:branchId/orders
GET  /api/push/vapid-public-key
GET  /api/app/snab-update
GET  /api/public/snab-apk
GET  /downloads/snabzenie.apk        → 302 на GitHub Releases
```

### Auth (дополнительно для снабжения)

```
GET  /api/app/snab-install           # shop_orders.view — ссылки APK/PWA
POST /api/push/subscribe             # Web Push или FCM { type: 'fcm', token }
```

### Auth

```
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
POST /api/auth/change-password
GET  /api/auth/roles
```

### Основные группы (требуют auth)

| Префикс | Файл маршрутов | Назначение |
|---------|---------------|------------|
| `/api/products` | catalog.routes.js | Номенклатура, варианты, изображения |
| `/api/calculations` | catalog.routes.js | Калькуляции |
| `/api/documents` | documents.routes.js | Складские документы |
| `/api/counterparties` | counterparties.routes.js | Контрагенты, договоры |
| `/api/payments` | finance.routes.js | Оплаты, касса |
| `/api/cash-articles` | finance.routes.js | Статьи кассы |
| `/api/stats`, `/api/reports/*` | org.routes.js | Отчёты, дашборд |
| `/api/branches`, `/api/departments`, `/api/users` | org.routes.js | Оргструктура |
| `/api/roles` | org.routes.js | Роли и права |
| `/api/shop-orders` | shopOrders.routes.js | Заявки MyShop |
| `/api/opening-balance` | openingBalance.routes.js | Начальное сальдо |
| `/api/telegram/*` | telegram.routes.js | Telegram |
| `/api/admin/*` | admin.routes.js | Аудит, бэкапы, сброс данных, сессии |
| `/api/staff/location` | staff.routes.js | Геолокация снабженца (POST, текущая точка + история) |
| `/api/admin/staff-locations` | staff.routes.js | Текущие позиции снабженцев (admin) |
| `/api/admin/staff-locations/history` | staff.routes.js | История точек за день/время для маршрута (admin) |
| `/api/admin/push/send` | push.routes.js | Рассылка push-уведомлений снабженцам (admin) |
| `/api/admin/push/subscribers` | push.routes.js | Список подписчиков push (admin) |

---

## 11. Страницы UI

| Маршрут | Файл | Права |
|---------|------|-------|
| `/` | Dashboard.jsx | dashboard.view |
| `/products` | Products.jsx | products.view |
| `/product-categories` | ProductCategories.jsx | products.view |
| `/units` | Units.jsx | products.view |
| `/counterparties` | Counterparties.jsx | counterparties.view |
| `/prihod`, `/rashod`, `/return-*`, `/transfer` | Documents.jsx | documents.* |
| `/documents` | Documents.jsx | documents.view |
| `/razdelka` | Razdelka.jsx | documents.razdelka |
| `/calculations` | Calculations.jsx | calculations.view |
| `/dish-sales` | DishSales.jsx | documents.dish_sale |
| `/cashier` | Cashier.jsx | cashier.* |
| `/payments` | Payments.jsx | payments.view |
| `/cash-articles` | CashArticles.jsx | cash_articles.view |
| `/reports/*` | Reports.jsx | reports.view |
| `/opening-balance` | OpeningBalance.jsx | opening_balance.view |
| `/myshop` | MyShop.jsx | myshop.view |
| `/myshop/constructor` | MyShopConstructor.jsx | myshop.edit |
| `/shop-orders` | ShopOrders.jsx | shop_orders.view |
| `/telegram` | Telegram.jsx | telegram.view |
| `/employees` | Employees.jsx | users.view |
| `/roles` | Roles.jsx | admin |
| `/branches` | Branches.jsx | admin |
| `/departments` | Departments.jsx | admin |
| `/tracking` | StaffTracking.jsx | admin: трекинг снабженцев с картой маршрута |
| `/security` | SecurityAdmin.jsx | admin: сеансы, трекинг, push (`AdminPushTab.jsx`), блокировки |
| `/audit-log` | AuditLog.jsx | admin |
| `/warehouse/orders` | ShopOrdersMobile.jsx | shop_orders (mobile) |

---

## 12. Мобильное приложение (Снабжение)

- **Capacitor app id:** `com.tandoor.snab`
- **Название:** Mahalla Снабжение
- **Текущая версия APK:** `1.0.7` (build **8**) — `android/app-version.json`, `android/app/build.gradle`
- **Скачивание APK:** [GitHub Releases](https://github.com/Davron5345/Tandoor/releases/latest/download/snabzenie.apk) (основной источник; файл >100 MB не хранится в git)
- **Зеркало на сайте:** `GET /downloads/snabzenie.apk` → редирект на GitHub Releases
- **Панель скачивания:** `client/src/components/SnabAppPanel.jsx` (в MyShop / заявки)

### Remote UI (главный принцип)

- `capacitor.config.ts` + env `CAPACITOR_SERVER_URL` при сборке CI → APK грузит UI с прод-сервера
- **Обычные изменения интерфейса** деплоятся на Railway — **переустановка APK не нужна**
- **Новый APK нужен** только при: новых native-плагинах, Android-разрешениях, смене `versionCode`

### Native-плагины (Android)

| Плагин | Назначение |
|--------|-----------|
| `@capacitor-community/background-geolocation` | Фоновая геолокация |
| `@capacitor/push-notifications` | FCM push (стандартный запрос разрешений Android) |
| `@capacitor/local-notifications` | Локальные уведомления |
| `@capacitor/app`, `@capacitor/filesystem` | Версия APK, скачивание обновления |
| `ApkInstallerPlugin` (Java) | Установка APK из приложения |

После `npm install` обязателен `npx cap sync android` — иначе в APK не будет native-модулей («plugin is not implemented»).

### Push-уведомления

| Канал | Где | Как |
|-------|-----|-----|
| **FCM (Android APK)** | `client/src/utils/nativePush.js` | `PushNotifications.requestPermissions()` → токен → `POST /api/push/subscribe` с `{ type: 'fcm', token }` |
| **Web Push (PWA/браузер)** | `client/src/utils/pwaPush.js` | Service Worker + VAPID |
| **Админ-рассылка** | `AdminPushTab.jsx`, `POST /api/admin/push/send` | Всем / по филиалу / выбранным; `GET /api/admin/push/subscribers` |

Сервер (`server/push.js`): endpoint `fcm:<token>` для native; обычный Web Push endpoint для браузера. Отправка FCM через `FCM_SERVER_KEY` (Legacy HTTP API).

**Настройка FCM (один раз):**
1. Firebase Console → Android app `com.tandoor.snab` → `google-services.json` → `android/app/`
2. Railway: `FCM_SERVER_KEY` (Cloud Messaging → Server key)
3. GitHub Secret: `GOOGLE_SERVICES_JSON` (содержимое файла) для CI сборки APK

### Обновление APK в приложении

- API: `GET /api/app/snab-update` (`server/snabAppVersion.js`)
- UI: баннер «Обновить APK» только если `server.versionCode > installedBuild` (и build известен)
- Установка: `client/src/utils/nativeApkUpdate.js` + `ApkInstallerPlugin`

### Экран снабженца (`ShopOrdersMobile.jsx`)

- Маршруты: `/warehouse/orders`, `/snab` (redirect)
- Профиль: `SnabProfileView.jsx` — версия, push, геолокация
- Тема: `ThemeContext` + `data-theme` на `<html>`; **не дублировать цветовые CSS-переменные в `:root`** (ломает тёмную тему)
- Трекинг: `useStaffLocationPing` + `backgroundLocation.js`

### Сборка APK

- Локально: `npm run android:apk` (нужен Android SDK)
- CI: `.github/workflows/android-apk.yml` — `CAPACITOR_SERVER_URL`, TypeScript, `npx cap sync`, Gradle release
- APK публикуется в **GitHub Releases** (не коммитится в git из-за лимита 100 MB)
- Документация для людей: `docs/SNAB_ANDROID.md` (частично устарела — см. этот раздел)

---

## 13. Переменные окружения

| Переменная | Назначение |
|-----------|-----------|
| `PORT` | Порт сервера (default 3001) |
| `NODE_ENV` | `production` отключает demo seed |
| `DATA_DIR` | Путь к `warehouse.db` и uploads (обязательно на Railway/Docker) |
| `TELEGRAM_BOT_TOKEN` | Токен бота |
| `TELEGRAM_ENABLED` | `false` для отключения |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (браузер/PWA) |
| `FCM_SERVER_KEY` | FCM push для Android APK (Legacy HTTP API) |
| `CAPACITOR_SERVER_URL` | URL прод-сервера при сборке APK (CI / локально) |
| `GOOGLE_SERVICES_JSON` | GitHub Actions secret → `android/app/google-services.json` при сборке |
| `SNAB_APK_URL` | Переопределить URL скачивания APK (default: GitHub Releases) |
| `APP_PUBLIC_URL` | Публичный URL сайта (для ссылок в API) |
| `CORS_ORIGIN` | Разрешённые origins (через запятую) |
| `COOKIE_SECURE` | Secure cookie flag |
| `ALLOW_DATA_RESET` | Разрешить API сброса данных |
| `DISABLE_DEMO_SEED` | Не заполнять демо-данные |
| `VITE_API_URL` | URL API для frontend build (Vite) |

---

## 14. Тесты

| Команда | Что тестирует |
|---------|--------------|
| `npm test` | Backend: auth, permissions, documents, payments, dish sales, opening balance, P&L, staff location... |
| `npm run test:e2e` | Playwright: UI flows |
| `npm run lint` | ESLint server + client + e2e |

Тесты в `server/test/` используют in-memory или temp DB. При добавлении бизнес-логики — добавляй тесты в соответствующий `*.test.js`.

---

## 15. Соглашения и паттерны

### Backend
- ESM imports с `.js` расширением
- UUID v4 для ID (`uuid` пакет)
- Ошибки бизнес-логики: `throw new Error('Сообщение на русском')`
- `assert*` функции для валидации (documentAccess, productKinds)
- Пагинация: `server/pagination.js`, ответ `{ items, total, page, limit, pages }`

### Frontend
- Функциональные компоненты, hooks
- Стили: `index.css` + page-specific CSS
- Черновики документов: `sessionStorage` / `localStorage`
- Даты: `utils/date.js`, локальные ISO строки `YYYY-MM-DD`
- Не добавляй UI-фреймворки без явного запроса

### Git
- `data/` в `.gitignore` — БД не коммитится
- Не коммить `.env`

---

## 16. Шпаргалка: где что менять

| Задача | Файлы |
|--------|-------|
| Новый API endpoint | `server/routes/*.routes.js` + `server/services/*.js` + `client/src/api.js` |
| Бизнес-правило документа | `server/services/documents.js` |
| Схема БД | `server/db.js` (миграция с settings key) |
| Новая страница UI | `client/src/pages/*.jsx` + маршрут в `App.jsx` + навигация |
| Права доступа | `server/permissions.js` + `client/src/permissions.js` |
| Отчёт | `server/services/reports.js` + `client/src/pages/Reports.jsx` |
| Вид товара / ограничения | `server/productKinds.js` |
| Себестоимость / остатки | `server/inventoryCost.js`, `server/departments.js` |
| MyShop | `server/myShop.js`, `server/publicShop.js`, `client/src/pages/MyShop*.jsx` |
| Telegram | `server/telegram.js`, `server/services/telegram.js` |
| Push (FCM + Web) | `server/push.js`, `client/src/utils/nativePush.js`, `client/src/utils/pwaPush.js` |
| APK снабжения | `server/snabAppVersion.js`, `nativeApkUpdate.js`, `.github/workflows/android-apk.yml` |
| Тема UI | `client/src/theme.js`, `ThemeContext.jsx` — не дублировать цвета в `:root` |
| Тест | `server/test/<feature>.test.js` |

---

## 17. Деплой

- **Railway / VPS:** смонтировать persistent volume на `DATA_DIR`
- Без persistent storage данные теряются при каждом деплое
- `npm run build && npm start`
- OpenAPI docs доступны на `/api/docs`

---

## 18. Журнал обновлений документации

| Дата | Что изменено |
|------|-------------|
| 2026-06-24 | Создана начальная версия документации |
| 2026-06-24 | Трекинг: API `/admin/staff-locations/history`, карта маршрута в SecurityAdmin, убран бейдж в APK |
| 2026-06-24 | Fix: lazy-load Leaflet на `/security`, вкладка переименована в «Трекинг снабженцев» |
| 2026-06-24 | Fix белого экрана: guard reload loop AppUpdateManager, fallback CSS, `/tracking` страница |
| 2026-06-24 | APK auto-update: `capacitor.config.ts` + remote server, `/api/app/snab-update`, in-app APK installer |
| 2026-06-24 | Admin push: `/api/admin/push/send`, вкладка в SecurityAdmin, push в native APK |
| 2026-06-24 | Снабжение: экран «Мой профиль», проверка версии APK, build 6 |
| 2026-06-26 | CI APK: TypeScript для `capacitor.config.ts`; APK на GitHub Releases (>100 MB) |
| 2026-06-26 | Push: FCM native (`@capacitor/push-notifications`), `FCM_SERVER_KEY`, выбор получателей в админке |
| 2026-06-26 | Fix: тёмная тема (`:root` не должен перекрывать `data-theme`), push после перезагрузки WebView |
| 2026-06-26 | APK build 8 (1.0.7): push-плагин в `capacitor.build.gradle`, fix чёрного экрана (import React) |
| 2026-06-26 | `/downloads/snabzenie.apk` → редирект GitHub; `SnabAppPanel` — основная ссылка на Releases |

---

*При изменении архитектуры, API, бизнес-правил, страниц UI или структуры проекта — обнови соответствующий раздел и добавь строку в «Журнал обновлений».*
