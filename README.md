# KanbanVibe Frontend

Vue 3 + Vite интерфейс Kanban-доски (из `ITMOv2` / `practices/practice_05`, ветка `integration/practice_05`).

## Требования

- Node.js 20+

## Локальный запуск

1. Запустите [backend API](https://github.com/x1000sag/kanbanVibe-Back) (`Kanban.Api`, порт **5050**).
2. В этом репозитории:

```bash
cp .env.example .env   # при необходимости поправить URL API
npm ci
npm run dev
```

Приложение: **http://localhost:5173**

## Сборка

Сборка зависит от [kanbanVibe-Back](https://github.com/x1000sag/kanbanVibe-Back) на git-теге `v0.0.0` (`package.json`, поле `kanbanVibeBackend`). `npm ci` и `npm run build` запускают `scripts/fetch-backend-tag.mjs`: скрипт забирает с GitHub именно этот тег в `vendor/kanbanVibe-Back`. Каталог `vendor/` не коммитится. Если тег недоступен, установка и сборка завершаются с ошибкой.

```bash
npm ci
npm run build
npm run preview
```

## Docker

```bash
docker compose up --build
```

Статика на порту **8080**. Задайте `VITE_API_BASE_URL` на хост бэкенда (по умолчанию `http://host.docker.internal:5050`).

## Spec Kit

Каталог `.specify/` и фича `specs/002-frontend-dev` перенесены из монорепозитория. Для обновления шаблонов Spec Kit:

```bash
uv tool install specify-cli
specify init --here --force --integration opencode --ignore-agent-tools
```