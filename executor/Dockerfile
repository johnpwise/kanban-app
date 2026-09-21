# syntax=docker/dockerfile:1

# --- build stage: install all deps (incl. dev) and compile TypeScript ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage: production-only deps + compiled output, non-root ---
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# git is a runtime capability (executor performs an HTTPS clone + checkout), not dev tooling — kept
# to this one minimal, no-recommends install so the image stays close to its prior size.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/lib ./lib
USER node

# Cloud Run Jobs run this as a one-shot process; there is no HTTP port to expose.
CMD ["node", "lib/main.js"]
