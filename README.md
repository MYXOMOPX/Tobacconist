# Tobacconist — групповые закупки табака

Telegram Mini App + бот для организации групповых закупок табака среди друзей. Админ ведёт каталог барыг/цен/наличия (наличие распознаётся с фото через Gemini vision), участники формируют заказы через Mini App, система собирает сводный заказ для барыги (текст + таблица + XLSX), отслеживает сверку поставки и оплаты.

Подробности логики — в `docs/superpowers/specs/2026-08-25-tobacconist-group-buy-design.md`.

## Стек и структура

Монорепозиторий на npm workspaces:

- `shared/` — общие TypeScript-типы (DTO)
- `server/` — Node.js + TypeScript, Fastify (REST API), grammY (бот, webhook-режим), SQLite + Drizzle ORM, Gemini vision
- `mini-app/` — React + Vite + TypeScript, Telegram WebApp SDK

Требуется **Node.js 20+**.

## Перед стартом: что понадобится

1. **Telegram-бот**: создать через [@BotFather](https://t.me/BotFather), получить токен вида `123456:AAAA...`.
2. **Telegram id администратора**: узнать свой числовой id (например через [@userinfobot](https://t.me/userinfobot)).
3. **Id группового чата**: добавить бота в чат друзей, узнать id чата (отрицательное число вида `-1001234567890`) — например через [@RawDataBot](https://t.me/RawDataBot) или логи бота после первого сообщения в группе.
4. **Gemini API key**: получить на [Google AI Studio](https://aistudio.google.com/apikey).
5. **Публичный HTTPS-домен**, под которым будет жить бэкенд (нужен боту для режима webhook и для Mini App — Telegram требует HTTPS).

## Локальная разработка

```bash
npm install
```

Создать `server/.env` (или экспортировать переменные окружения перед запуском) со значениями:

| Переменная | Обязательна | Значение |
|---|---|---|
| `BOT_TOKEN` | да | токен бота от BotFather |
| `TELEGRAM_ADMIN_ID` | да | Telegram id администратора |
| `TELEGRAM_GROUP_CHAT_ID` | да | id группового чата |
| `GEMINI_API_KEY` | да | API-ключ Gemini |
| `PUBLIC_URL` | да | публичный HTTPS-адрес бэкенда (используется для регистрации webhook) |
| `DB_PATH` | нет, по умолчанию `./data/tobacconist.sqlite3` | путь к файлу SQLite |
| `PORT` | нет, по умолчанию `3000` | порт HTTP-сервера |

> В локальной разработке без реального HTTPS-туннеля (ngrok/cloudflared) бот не сможет принимать апдейты через webhook, но REST API и Mini App работают независимо от этого — их можно тестировать без живого бота.

Запуск сервера в режиме разработки:

```bash
npm run build --workspace=@tobacconist/server
npm run start --workspace=@tobacconist/server
```

Запуск Mini App отдельно (для разработки UI, с hot-reload):

```bash
cd mini-app
npm run dev
```

Vite dev-сервер проксирует `/api/*` на `http://localhost:3000`, поэтому сервер должен быть запущен параллельно. Открывать Mini App внутри самого Telegram (например через `ngrok` + указание адреса в BotFather) — SDK `window.Telegram.WebApp` плохо эмулируется вне Telegram.

## Тесты

```bash
npm run test                          # все три workspace: shared, server, mini-app
npm run test --workspace=@tobacconist/server
npm run test --workspace=@tobacconist/mini-app
```

Проверка типов:

```bash
cd server && npx tsc -p tsconfig.json --noEmit
cd mini-app && npx tsc -p tsconfig.json --noEmit
```

## Деплой (Docker + Traefik)

Сборка и деплой рассчитаны на VPS, где уже поднят Traefik как reverse-proxy с внешней Docker-сетью `traefik` и cert resolver'ом с именем `le`. Если у вас другие имена — поправьте `deploy/docker-compose.yml`.

1. Скопировать `deploy/.env.example` в `deploy/.env` и заполнить реальными значениями:

   ```bash
   cp deploy/.env.example deploy/.env
   ```

   | Переменная | Назначение |
   |---|---|
   | `BOT_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_GROUP_CHAT_ID`, `GEMINI_API_KEY` | см. таблицу выше |
   | `PUBLIC_URL` | полный HTTPS-адрес, например `https://tobacconist.example.com` |
   | `PUBLIC_HOST` | тот же домен без схемы — используется в Traefik-лейбле для `Host()`-правила |
   | `DB_PATH` | путь к SQLite внутри контейнера, по умолчанию `/app/data/tobacconist.sqlite3` — не менять без необходимости, это путь внутри примонтированного volume |
   | `PORT` | порт, на котором слушает процесс внутри контейнера (по умолчанию `3000`, совпадает с лейблом Traefik) |

2. Собрать и поднять:

   ```bash
   cd deploy
   docker compose build
   docker compose up -d
   ```

   Сборка — многостадийная (`Dockerfile` в корне репозитория): собирает `shared` → `server` → `mini-app`, финальный образ содержит только собранные артефакты и рантайм-зависимости. SQLite-файл и загруженные фото наличия хранятся в volume `tobacconist-data`, переживают пересоздание контейнера.

3. Webhook бот регистрирует **автоматически при каждом старте** (`server/src/index.ts`, вызов `setWebhook` на `${PUBLIC_URL}/telegram/webhook`) — отдельный шаг не нужен. Скрипт `deploy/scripts/set-webhook.sh` — вспомогательный, для ручной перерегистрации/диагностики (`getWebhookInfo`), если что-то не так:

   ```bash
   BOT_TOKEN=... PUBLIC_URL=https://tobacconist.example.com bash deploy/scripts/set-webhook.sh
   ```

4. Проверить, что бэкенд жив:

   ```bash
   curl https://tobacconist.example.com/api/health
   ```

### Обновление после деплоя

```bash
cd deploy
docker compose build
docker compose up -d
```

Миграция схемы БД (`server/src/db/migrations/0000_init.sql`) идемпотентна — безопасно переисполняется при каждом рестарте контейнера, повторный запуск не ломает существующие данные.

### Бэкап

SQLite-файл — единственный источник данных приложения (плюс загруженные фото наличия в том же volume). Регулярно копировать содержимое volume `tobacconist-data`, например по cron:

```bash
docker run --rm -v tobacconist-data:/data -v /path/to/backups:/backup alpine \
  tar czf /backup/tobacconist-$(date +%F).tar.gz -C /data .
```

## После деплоя: первое использование

1. Открыть Mini App как администратор (кнопка бота в чате, или прямая ссылка на `PUBLIC_URL` внутри Telegram) — зайти на вкладку «Каталог», добавить барыгу, бренды, выставить цены (€/кг), загрузить фото наличия.
2. Начать раунд закупки — либо командой `/start_round` в групповом чате (бот покажет кнопки с барыгами), либо кнопкой в Mini App на вкладке «Раунд».
3. Участники группы открывают Mini App и формируют свои заказы.
4. Админ в любой момент снимает слепок заказа (текст/таблица/XLSX в личку) и закрывает раунд — после закрытия открывается чек-лист сверки поставки и отметки оплаты.
