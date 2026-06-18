# syntax = docker/dockerfile:1
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS base-node
WORKDIR /app
ENV NODE_ENV="production"
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
    build-essential \
    node-gyp \
    pkg-config \
    python-is-python3 \
    curl \
    ca-certificates \
    unzip \
    libc6 \
    && rm -rf /var/lib/apt/lists/*

FROM base-node AS build-main
# Copy package files
COPY website/package.json website/package-lock.json* ./

# Install dependencies with platform-specific binaries
RUN npm ci --include=dev --platform=linux --arch=x64

# Copy the rest of the application
COPY website/. .

# Create .svelte-kit directory if it doesn't exist
RUN mkdir -p .svelte-kit

# Generate SvelteKit types and build.
# SvelteKit's postbuild `analyse` step loads the server module graph, which trips
# env-guards in db/index.ts & auth.ts (they throw if env is missing). We inject
# NON-SECRET placeholders here so analyse passes. Real values come from the
# container env_file at runtime; none of these reach the final production image
# (production-main is a separate stage that only COPYs build/ + node_modules, and
# the app reads all env via $env/dynamic/* at runtime, so nothing is baked).

ENV DATABASE_URL="postgresql://build:build@build:5432/build" \
    REDIS_URL="redis://build:6379" \
    PUBLIC_BETTER_AUTH_URL="http://localhost" \
    PUBLIC_WEBSOCKET_URL="ws://localhost:8080" \
    GOOGLE_CLIENT_ID="build-placeholder" \
    GOOGLE_CLIENT_SECRET="build-placeholder" \
    PRIVATE_BETTER_AUTH_SECRET="build-placeholder-placeholder" \
    PRIVATE_B2_KEY_ID="build" \
    PRIVATE_B2_APP_KEY="build" \
    PUBLIC_B2_BUCKET="build" \
    PUBLIC_B2_ENDPOINT="https://build.local" \
    PUBLIC_B2_REGION="build" \
    GEMINI_API_KEY="build-placeholder"

RUN npm run build

FROM base-node AS build-websocket
WORKDIR /websocket
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
COPY website/websocket/package.json website/websocket/bun.lock* ./
COPY website/websocket/tsconfig.json ./
RUN bun install
COPY website/websocket/src ./src/
RUN bun build src/main.ts --outdir dist --target bun

FROM base-node AS production-main
COPY --from=build-main --chown=node:node /app/build ./build
COPY --from=build-main --chown=node:node /app/node_modules ./node_modules
COPY --from=build-main --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "build"]

FROM oven/bun:1 AS production-websocket
WORKDIR /websocket
COPY --from=build-websocket --chown=bun:bun /websocket/dist ./dist
COPY --from=build-websocket --chown=bun:bun /websocket/package.json ./package.json
USER bun
EXPOSE 8080
CMD ["bun", "run", "dist/main.js"]