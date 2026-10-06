# Образ JoyRest Games: собранная платформа + сайт агентства + сервер + файлы выкладки (deploy/).
# Собирается только в GitHub Actions; сервер его скачивает из GHCR и ничего не собирает.
# Базовые образы берутся с Docker Hub здесь, в GitHub; сервер к Docker Hub не обращается.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:server && npm run build:site

FROM node:22-bookworm-slim
ARG APP_VERSION=dev
ARG APP_IMAGE=ghcr.io/joonde/joyrest-app:dev
ENV NODE_ENV=production \
    PORT=8080 \
    PUBLIC_DIR=/app/public \
    SITE_DIR=/app/site \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build /src/dist ./public
# Сайт агентства joy-rest.ru (site/ → build/site, scripts/build-site.ts).
COPY --from=build /src/build/site ./site
COPY --from=build /src/build/server ./server
COPY server/migrations ./migrations
COPY deploy ./deploy
# Заглушка joy-rest.ru показывает логотип и иконку из фирменных файлов.
COPY public/brand/joyrest-logo.svg public/brand/favicon.svg ./deploy/caddy/soon/
# Описание версии: по нему сервер знает, какой образ запускать и что выложено.
RUN printf 'APP_VERSION=%s\nAPP_IMAGE=%s\n' "$APP_VERSION" "$APP_IMAGE" > ./deploy/release.env
USER node
EXPOSE 8080
CMD ["node", "server/main.js"]
