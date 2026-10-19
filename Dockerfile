FROM oven/bun:1.4.3-alpine
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --production --frozen-lockfile
COPY src ./src
COPY static ./static
RUN mkdir -p /data && chown bun:bun /data
ENV NODE_ENV=production DB_PATH=/data/finance.sqlite PORT=3000
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=1m --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["bun", "src/server.ts"]
