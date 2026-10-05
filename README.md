# JoyRest Games

Платформа квизов и игр для ведущих агентства JoyRest. Архитектура и правила — в [CLAUDE.md](CLAUDE.md).

## Команды

```bash
npm install
npm run dev          # локальный запуск против боевого Firebase
npm run build        # проверка типов и сборка в dist/
npm test             # тесты логики (Vitest)
npm run test:rules   # тесты firestore.rules в эмуляторе (нужна Java)
```

Запуск против эмуляторов Firebase:

```bash
npx firebase emulators:start --only auth,firestore --project demo-joyrest
VITE_USE_EMULATORS=true npm run dev
```

## Структура

- `src/data/` — единственный слой доступа к данным (Firebase). Компоненты импортируют только `src/data`.
- `src/core/` — чистая логика без Firebase и React: коды сессий, имена, таблица лидеров.
- `src/mechanics/` — интерфейс и реестр игровых механик.
- `src/themes/` — темы оформления как данные; переводятся в CSS-переменные.
- `src/screens/` — экраны по маршрутам `/studio`, `/admin`, `/host/:code`, `/screen/:code`, `/play/:code`, `/j`.
- `firestore.rules` и `tests/rules/` — правила безопасности и их тесты.

Хостинг: Vercel (`vercel.json`) или Netlify (`netlify.toml`), сборка `npm run build`, папка `dist`.
