# Приложение «Снабжение» для Android (фоновая геолокация)

Нативное Android-приложение без Play Market. Отслеживает местоположение снабженца **в фоне** (приложение свёрнуто, экран выключен).

## Что нужно на компьютере

1. **Node.js 20+** (уже есть)
2. **Android Studio** — [developer.android.com/studio](https://developer.android.com/studio)
3. В Android Studio: SDK Platform 34+, Android SDK Build-Tools

## Сборка APK

```bash
npm run setup
npm run android:apk
```

Готовый файл:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Раздайте сотрудникам этот файл (Telegram, USB, общая папка). При установке Android попросит разрешить «Неизвестные источники».

## Настройка сервера

APK по умолчанию подключается к:

`https://tandoor-production.up.railway.app`

Для другого сервера соберите с переменной:

```bash
set VITE_API_URL=https://ваш-домен.railway.app
npm run android:apk
```

## Первый запуск на телефоне

1. Установить APK
2. Войти логином снабженца
3. Нажать **«Фоновая геолокация»**
4. Разрешить:
   - **Местоположение → Всегда** (или «Разрешить всё время»)
   - **Уведомления** (для постоянного уведомления о трекинге — требование Android)

В шторке появится уведомление «Снабжение — геолокация». Пока оно есть, координаты уходят на сервер каждые ~30 м перемещения.

## Где смотреть администратору

**Безопасность** → **Где сотрудники**. Источник **Android (фон)** — данные из нативного приложения.

## Открыть проект в Android Studio

```bash
npm run cap:sync
npm run android:open
```

Для release-подписи настройте signing config в `android/app/build.gradle` (Android Studio → Build → Generate Signed Bundle/APK).

## PWA vs Android APK

| | PWA (Chrome) | Android APK |
|---|---|---|
| Установка | С сайта | Файл .apk |
| Геолокация в фоне | Нет | Да |
| Push-уведомления | Да | Частично (Web Push в WebView) |

Для полного фонового трекинга сотрудникам нужен **Android APK**.
