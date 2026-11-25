# KanbanVibe Frontend

Vue 3 + Vite. Экран своей доски работает без живого сервиса: учётка, профиль и карточки приходят из подмены в памяти вкладки.

## Требования

- Node.js 22, как в CI.

## Локальный запуск

Для этого экрана не нужно запускать kanbanVibe-Back, PostgreSQL и не нужен git-тег `v1.0.0`.

```bash
npm ci
npm run dev
```

Приложение: **http://localhost:5173**

Адрес в `.env.example` остаётся `http://localhost:5050`. Эта поставка его для запросов не читает.

Обновление страницы очищает подмену: учётки не переживают перезагрузку вкладки.

## Проверка

Команды из `specs/003-account-board-screen/quickstart.md`:

```bash
npm run build
npm test
```

`npm test` запускает только Playwright: критический путь, клавиатуру, форму контракта и снимки.

## Сборка

```bash
npm ci
npm run build
npm run preview
```

## Docker

```bash
docker compose up --build
```

Статика на порту **8080**. Образ не ходит в API за доской этого экрана.

## Spec Kit

Каталог `.specify/` и фича `specs/003-account-board-screen` описывают экран своей доски. Для обновления шаблонов Spec Kit:

```bash
uv tool install specify-cli
specify init --here --force --integration opencode --ignore-agent-tools
```
