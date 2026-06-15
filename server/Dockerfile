# --- build stage ------------------------------------------------------------
# Build context is the REPO ROOT (see .github/workflows/deploy.yml:
#   flyctl deploy --config server/fly.toml --dockerfile server/Dockerfile .)
# so the server can bundle the shared engine from frontend/src/lib. esbuild
# inlines the engine into dist/index.js; the runtime ships only the bundle.
FROM node:22-slim AS build
WORKDIR /app/server

# Build tools for native modules (better-sqlite3).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json* ./
RUN npm install

COPY server/tsconfig.json ./
COPY server/src ./src
# The shared, isomorphic engine (single source of truth for game rules).
COPY frontend/src/lib /app/frontend/src/lib
RUN npm run build && npm prune --omit=dev

# --- runtime stage ----------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8080

COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./package.json

EXPOSE 8080
CMD ["node", "dist/index.js"]
