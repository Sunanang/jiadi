FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ledger-domain.mjs jiadi-ui.html shared-client.js ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
