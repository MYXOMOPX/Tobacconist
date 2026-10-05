# Tobacconist — групповые закупки табака

Telegram Mini App + бот для организации групповых закупок табака среди друзей. Админ ведёт каталог барыг/цен/наличия (наличие распознаётся с фото через Gemini vision), участники формируют заказы через Mini App, система собирает сводный заказ для барыги (текст + таблица), отслеживает сверку поставки и оплаты.

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
| `GEMINI_BACKEND` | нет, по умолчанию `api` | `api` — Gemini API по ключу; `agy` — локально установленный и залогиненный CLI agy, у него нет лимитов ключа. agy должен стоять на той машине, где запущен сервер (в Docker-образе его нет — для agy запускай сервер на хосте) |
| `GEMINI_API_KEY` | да при `GEMINI_BACKEND=api` | API-ключ Gemini |
| `GEMINI_MODEL` | нет, по умолчанию `gemini-3.5-flash` (для agy — `gemini-3.6-flash-medium`) | id модели. Для agy это id из `agy models` (например `gemini-3.8-flash-high`). Google выводит старые id из обращения — тогда меняется здесь, без релиза кода |
| `AGY_PATH` | нет, по умолчанию `agy` | путь к исполняемому файлу agy |
| `AGY_TIMEOUT_SECONDS` | нет, по умолчанию `180` | сколько ждать ответа agy на один скрин |
| `PUBLIC_URL` | да | публичный HTTPS-адрес бэкенда (используется для регистрации webhook) |
| `TELEGRAM_MINIAPP_LINK` | почти да | прямая ссылка на Mini App из BotFather, например `https://t.me/mybot/order`. Без неё бот постит объявления **без кнопки** «Открыть заказ» (см. ниже) |
| `DB_PATH` | нет, по умолчанию `./data/tobacconist.sqlite3` | путь к файлу SQLite |
| `PORT` | нет, по умолчанию `3000` | порт HTTP-сервера |
| `DEV_NO_TELEGRAM` | нет | `true` — запуск без Telegram, см. ниже. **Только для локалки** |
| `DEV_ADMIN_NAME` | нет | при `DEV_NO_TELEGRAM=true` — имя, которое получает роль админа. Пусто: админом становится тот, кто зашёл первым |

### Кнопка «Открыть заказ» в групповом чате

Объявления бота в группе несут кнопку, открывающую Mini App сразу на нужном заказе. Кнопки типа `web_app` Telegram разрешает **только в приватных чатах** — в группе они отлетают с `400 BUTTON_TYPE_INVALID`. Поэтому в группе используется обычная url-кнопка с прямой ссылкой на Mini App, которую Telegram сам разворачивает в приложение.

Такую ссылку выдаёт BotFather:

1. `/newapp` → выбрать бота;
2. заполнить название, описание, картинку `640x360`;
3. **Web App URL** — значение `PUBLIC_URL` (например `https://tobacconist.example.com`);
4. **short name** — короткое имя латиницей, например `order`;
5. BotFather ответит ссылкой вида `https://t.me/<бот>/<short name>` — её и класть в `TELEGRAM_MINIAPP_LINK`.

Номер заказа уезжает в ссылку как `?startapp=order_<id>` и приходит в мини-апп как `start_param`. Если переменную не задать, сервер при старте напишет предупреждение, а сообщения будут уходить без кнопки — всё остальное продолжит работать.

> В локальной разработке без реального HTTPS-туннеля (ngrok/cloudflared) бот не сможет принимать апдейты через webhook, но REST API и Mini App работают независимо от этого — их можно тестировать без живого бота.

### Запуск без Telegram

`DEV_NO_TELEGRAM=true` — чтобы дебажить, не поднимая туннель. Бот не создаётся, webhook не регистрируется, объявление об открытии заказа уходит в лог; `BOT_TOKEN`, `TELEGRAM_*`, `GEMINI_API_KEY` и `PUBLIC_URL` становятся необязательными (без ключа Gemini не будет работать только распознавание скринов). Подпись initData не проверяется и членство в чате не спрашивается: личность берётся из заголовка `X-Dev-User`, мини-апп вне Telegram сам спросит имя и запомнит его. Роль запоминается за именем при первом входе.

**Никогда не включать там, куда есть доступ снаружи**: с этим флагом кто угодно ходит в API под любым именем, в том числе админом.

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

Vite dev-сервер проксирует `/api/*` на `http://localhost:3000`, поэтому сервер должен быть запущен параллельно. В обычном режиме Mini App надо открывать внутри самого Telegram (например через `ngrok` + указание адреса в BotFather) — SDK `window.Telegram.WebApp` вне Telegram не работает. С `DEV_NO_TELEGRAM=true` (см. выше) страница открывается прямо в браузере: SDK не найдётся, мини-апп спросит имя и запомнит его в localStorage (сбросить — очистить ключ `tb-dev-user`).

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

Сборка и деплой рассчитаны на VPS, где уже поднят Traefik как reverse-proxy с внешней Docker-сетью `containers-net` и cert resolver'ом с именем `le`. Если у вас другие имена — поправьте `deploy/docker-compose.yml`.

1. Скопировать `deploy/.env.example` в `deploy/.env` и заполнить реальными значениями:

   ```bash
   cp deploy/.env.example deploy/.env
   ```

   | Переменная | Назначение |
   |---|---|
   | `BOT_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_GROUP_CHAT_ID`, `GEMINI_API_KEY`, `GEMINI_MODEL` | см. таблицу выше |
   | `PUBLIC_URL` | полный HTTPS-адрес, например `https://tobacconist.example.com` |
   | `TELEGRAM_MINIAPP_LINK` | прямая ссылка на Mini App из BotFather, например `https://t.me/tobacconist_bot/order` |
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

### Gemini через agy в Docker (вместо API-ключа)

Нужно, когда упёрлись в лимиты ключа. agy работает под твоим Google-аккаунтом, а режим «agy с API-ключом» лимитов не снимает — это тот же ключ. Поэтому нужен вход через аккаунт.

1. В `deploy/.env` поставь `INSTALL_AGY=true` и `GEMINI_BACKEND=agy` (`GEMINI_API_KEY` можно убрать). Модель по умолчанию `gemini-3.6-flash-medium`, меняется через `GEMINI_MODEL`.
2. Пересобери и подними: `cd deploy && docker compose build && docker compose up -d`.
3. **Один раз** войди в аккаунт внутри контейнера:

   ```bash
   docker compose exec -it tobacconist agy
   ```

   agy напечатает ссылку для входа. Открой её в браузере на своём компьютере, войди и вставь полученный код обратно в консоль. Потом выйди из agy (`/exit` или Ctrl+C).
4. Вход хранится в volume `agy-config` (`/root/.gemini`) и переживает пересборку и перезапуск. Проверь: `docker compose restart tobacconist` и загрузи скрин. Если после перезапуска agy снова просит войти, значит он держит токен в системной связке ключей, которой нет в контейнере. В таком случае напиши, разберёмся.
5. Проверка без мини-аппа: `docker compose exec tobacconist agy -p "ответь: ок" --output-format json`.

Обновлять `agy` отдельно не нужно: он ставится при `docker compose build`. Чтобы подтянуть новую версию, пересобери с `--no-cache`.

### Обновление после деплоя

```bash
cd deploy
docker compose build
docker compose up -d
```

Миграции лежат в `server/src/db/migrations/` и применяются по одной, в порядке имён файлов; применённые записываются в таблицу `schema_migrations` и повторно не выполняются. Рестарт контейнера безопасен.

⚠️ Миграция `0001_orders.sql` перестраивает таблицы (раунды → заказы, см. §5 спеки) и, в отличие от `0000`, не идемпотентна — она полагается на журнал `schema_migrations`. **Перед первым обновлением на эту версию сделай бэкап volume** (см. ниже) — откатиться можно только восстановлением файла БД.

### Бэкап

SQLite-файл — единственный источник данных приложения (плюс загруженные фото наличия в том же volume). Регулярно копировать содержимое volume `tobacconist-data`, например по cron:

```bash
docker run --rm -v tobacconist-data:/data -v /path/to/backups:/backup alpine \
  tar czf /backup/tobacconist-$(date +%F).tar.gz -C /data .
```

## После деплоя: первое использование

1. Открыть Mini App как администратор (кнопка бота в чате, или прямая ссылка на `PUBLIC_URL` внутри Telegram) — зайти на вкладку «Барыги», добавить барыгу и выставить цены (€/кг). Наличие: выбрать барыгу и закинуть скрины прайса — бренд, граммовку и вкусы распознает ИИ, а на экране сверки всё это можно поправить. Переключатель «Убрать всё другое наличие» гасит у этого барыги всё, чего нет в загруженных скринах.
2. Открыть заказ — либо командой `/start_order` в групповом чате (бот покажет кнопки с барыгами), либо кнопкой «Новый заказ» на вкладке «Заказы». У каждой барыги может быть только один активный заказ, но у разных барыг — параллельно.
3. Участники открывают Mini App (кнопка в объявлении бота ведёт сразу в нужный заказ), набирают позиции и отмечаются готовыми.
4. Админ снимает слепок заказа (текст/таблица) и переводит заказ «На сверку» — открывается чек-лист поставки.
5. После сверки «Завершить заказ»: если привезли не всё, приложение спросит, у кого позиции меняются, и пересчитает суммы к оплате по факту. Дальше — отметки оплаты; заказ уходит в историю.
