# d37 realtime relay (docs/SERVER.md). Multi-arch base image: linux/arm64 (Oracle Ampere A1) and amd64; no native modules.
FROM node:22.23.3-alpine3.24
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
# журнал для античита (AUDIT=file, выключен по умолчанию): каталог под том rt_audit — владелец node (том берёт права отсюда)
RUN mkdir -p /audit && chown node:node /audit
USER node
# heap limit below the container limit (512 MB): a leak ends in a clean restart, not in the kernel killing other services
CMD ["node", "--max-old-space-size=320", "src/server.js"]
