# --- deps: 只装依赖，方便被后面两个阶段复用缓存 ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: next build 产出 .next/standalone ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner: 只带运行所需的最小产物 ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S vanspend && adduser -S vanspend -G vanspend

# standalone 输出自带一份按依赖裁剪过的 node_modules + 编译后的 server.js，
# 但不含 .next/static 和 config/sql 这类运行时用 fs 直接读取(而非 import)的文件，需单独拷贝
COPY --from=builder --chown=vanspend:vanspend /app/.next/standalone ./
COPY --from=builder --chown=vanspend:vanspend /app/.next/static ./.next/static
COPY config ./config
COPY sql ./sql

RUN mkdir -p uploads && chown -R vanspend:vanspend /app
USER vanspend

EXPOSE 5173
ENV PORT=5173

CMD ["node", "server.js"]
