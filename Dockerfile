FROM node:22-alpine
WORKDIR /app
# Alpine 默认 UTC；装 tzdata 并把 TZ 指到东八区，否则 cron「按本地时间」在容器里会偏 8 小时
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
COPY package.json server.mjs ledger-domain.mjs notify.mjs jiadi-ui.html shared-client.js ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
