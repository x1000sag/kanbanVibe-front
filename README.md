# KanbanVibe Frontend

Vue 3 + Vite. Экран своей доски вызывает учётный API [kanbanVibe-Back](https://github.com/x1000sag/kanbanVibe-Back) на git-теге `v1.0.0`, префикс `/v1`.

## Требования

- Node.js 22, как в CI.
- Для живого экрана — Kanban.Api этого тега.
- Для закрытого репозитория бэкенда — переменная `BACKEND_SSH_DEPLOY_KEY` при `npm ci` и `npm run build`.

## Локальный запуск

```bash
npm ci
npm run dev
```

Приложение: **http://localhost:5173**. Адрес API — `VITE_API_BASE_URL`, пример в `.env.example` (`http://localhost:5050`). Если переменная не задана, экран использует этот адрес.

`npm test` не ходит в API: Playwright поднимает тот же экран со стендом в памяти.

## Проверка

Команды из `specs/003-account-board-screen/quickstart.md`:

```bash
npm run build
npm test
```

`npm run build` забирает тег `v1.0.0` и заканчивается нулём. `npm test` запускает только Playwright: критический путь, клавиатуру, форму контракта, вызовы адаптера и снимки.

## Сборка

Сборка зависит от kanbanVibe-Back на git-теге `v1.0.0` (`package.json`, поле `kanbanVibeBackend`). `npm ci` и `npm run build` запускают `scripts/fetch-backend-tag.mjs` и кладут этот тег в `vendor/kanbanVibe-Back`. Каталог `vendor/` не коммитится. Если тег недоступен, установка и сборка завершаются с ошибкой.

```bash
npm ci
npm run build
npm run preview
```

## Docker

```bash
docker compose up --build
```

Статика на порту **8080**. Образ забирает тот же тег. `VITE_API_BASE_URL` по умолчанию `http://host.docker.internal:5050`.

## Spec Kit

Каталог `.specify/` и фича `specs/003-account-board-screen` описывают экран своей доски. Для обновления шаблонов Spec Kit:

```bash
uv tool install specify-cli
specify init --here --force --integration opencode --ignore-agent-tools
```
