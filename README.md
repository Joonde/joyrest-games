# JoyRest Games

Платформа квизов и игр для ведущих агентства JoyRest. Архитектура и правила — в [CLAUDE.md](CLAUDE.md).

## Команды

```bash
npm install
npm run dev          # локальный запуск против боевого Firebase
npm run build        # проверка типов и сборка в dist/
npm test             # тесты логики (Vitest)
npm run test:rules   # тесты firestore.rules в эмуляторе (нужна Java)
npm run build:server # сервер (server/) в один файл build/server/main.js
```

Свой сервер (переезд с Firebase): `server/` — код, `deploy/` — Docker Compose, Caddy, скрипты
настройки и команда `joyrest`, `Dockerfile` — образ, который собирает GitHub Actions.
Управление сервером с телефона — [RUNBOOK.md](RUNBOOK.md).

Запуск против эмуляторов Firebase:

```bash
npx firebase emulators:start --only auth,firestore --project demo-joyrest
VITE_USE_EMULATORS=true npm run dev
```

## Структура

- `src/data/` — единственный слой доступа к данным (Firebase). Экраны работают через интерфейсы `src/data/contracts.ts` и экземпляры из `src/data/index.ts`; права — `src/data/permissions.ts` (чистые функции с тестами, те же, что в `firestore.rules`). SDK грузится динамически: `src/data/firebase.ts` и обёртки `src/data/sdk/`.
- `src/core/` — чистая логика без Firebase и React: коды сессий, имена, таблица лидеров, итоги игр, срок хранения сессий, временные пароли, копии игр.
- `src/mechanics/` — интерфейс и реестр игровых механик.
- `src/themes/` — темы оформления как данные; переводятся в CSS-переменные. Палитра JoyRest — `brand.ts`, проверка контраста — `contrast.test.ts`.
- `public/fonts/` и `src/fonts.css` — свои шрифты Cormorant Garamond и Jost (без Google Fonts).
- `src/brand/qrSvg.ts` — QR-код в фирменном стиле; тест распознаёт его через jsQR.
- `public/brand/` — файлы логотипа и иконка сайта; компонент `src/components/Logo.tsx` встраивает их с цветом из темы. Витрина стиля — `/brand`.
- `src/screens/` — экраны по маршрутам `/admin`, `/host/:code`, `/screen/:code`, `/play/:code`, `/j`, `/results/:id`; студия (`/studio/…`) — в `src/screens/studio/`.
- `firestore.rules` и `tests/rules/` — правила безопасности и их тесты.

Хостинг: Netlify (`netlify.toml`): сборка `npm run build`, папка `dist`, все маршруты отдают `index.html`. Vercel не используем: он блокирует регистрацию из России.
