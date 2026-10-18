# Build context is the nodeboard/ root: the server imports the client's
# src/model (links, permissions, graph) so both sides parse links identically.
FROM node:22-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/model /app/src/model
COPY server/tsconfig.json ./
COPY server/sql ./sql
COPY server/src ./src
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node_modules/.bin/tsx", "src/main.ts"]
