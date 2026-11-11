# --- deps: 只装依赖，方便被后面两个阶段复用缓存 ---
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: next build 产出 .next/standalone ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner: 只带运行所需的最小产物 ---
FROM node:22-alpine AS runner
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

EXPOSE 3000
ENV PORT=3000

# standalone 的 server.js 绑定在 $HOSTNAME(容器 IP)而不是 127.0.0.1，所以探测也连 $HOSTNAME。只报告健康状态(Docker 不会自动重启 unhealthy 的容器)。/api/auth/captcha 不查库，库不可达时也返回 200。
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get({host:process.env.HOSTNAME,port:3000,path:'/api/auth/captcha'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
