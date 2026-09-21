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
# to this minimal, no-recommends install so the image stays close to its prior size. ca-certificates
# is required explicitly: it is only a Recommends of git on Debian, so --no-install-recommends
# leaves git with no CA trust store and every HTTPS clone fails TLS verification.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/lib ./lib
USER node

# Cloud Run Jobs run this as a one-shot process; there is no HTTP port to expose.
CMD ["node", "lib/main.js"]
