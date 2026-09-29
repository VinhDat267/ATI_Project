FROM node:22-alpine

WORKDIR /app

# Copy root and workspace package manifests for layer caching
COPY package.json package-lock.json tsconfig.json ./
COPY packages/dsl/package.json ./packages/dsl/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY apps/mcp-task-hub/package.json ./apps/mcp-task-hub/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --ignore-scripts

# Copy project files
COPY packages ./packages
COPY apps ./apps
COPY db ./db
COPY testdata ./testdata
COPY scripts ./scripts

# Build all workspaces (including web in live mode)
RUN npm run build -w @wap/dsl \
 && npm run build -w @wap/db \
 && npm run build -w @wap/mcp-task-hub \
 && npm run build -w @wap/engine \
 && npm run build -w @wap/api \
 && npm run build:live -w @wap/web

EXPOSE 3001 5173

CMD ["node", "scripts/docker-api-entrypoint.mjs"]
