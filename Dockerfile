# Versions verified against the official release pages on 2026-10-20.
FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci
COPY backend ./backend
COPY frontend ./frontend
RUN npm run build && npm prune --omit=dev

FROM node:24.22.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend ./backend
COPY --from=build --chown=node:node /app/frontend/dist ./frontend/dist
COPY --chown=node:node deploy/app-entrypoint.sh ./deploy/app-entrypoint.sh
USER node
EXPOSE 3000
CMD ["sh", "deploy/app-entrypoint.sh"]
