FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY config ./config
COPY sql ./sql
COPY src ./src
COPY public ./public

RUN mkdir -p uploads && addgroup -S vanspend && adduser -S vanspend -G vanspend \
    && chown -R vanspend:vanspend /app
USER vanspend

ENV NODE_ENV=production
EXPOSE 5173

CMD ["node", "--no-warnings", "src/server.js"]
