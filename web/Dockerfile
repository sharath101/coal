# The website for the test deployment (docs/demo-hosting.md).
# Build from the repository root: docker build -f web/Dockerfile --build-arg COAL_API_URL=… .
FROM node:22-bookworm-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /coal

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY shared/package.json shared/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --filter @coal/web...

COPY . .
# Next.js fixes the /api/v1 rewrite to the backend when it builds, so the address is needed here.
ARG COAL_API_URL=http://127.0.0.1:4000
ENV COAL_API_URL=$COAL_API_URL
RUN pnpm --filter @coal/web build

WORKDIR /coal/web
EXPOSE 3000
CMD ["sh", "-c", "exec ./node_modules/.bin/next start --port ${PORT:-3000}"]
