# The backend for the test deployment (docs/demo-hosting.md). It runs as in local work: the
# database is migrated on every start, then the API and the worker run in one process.
# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:22-bookworm-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /coal

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY shared/package.json shared/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter @coal/backend...

COPY . .
WORKDIR /coal/backend
ENV API_HOST=:: API_PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "pnpm db:migrate && exec ./node_modules/.bin/tsx src/dev.ts"]
