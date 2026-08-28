FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY mini-app/package.json mini-app/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace=@tobacconist/shared
RUN npm run build --workspace=@tobacconist/server
RUN npm run build --workspace=@tobacconist/mini-app

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/src/db/migrations ./server/dist/db/migrations
COPY --from=build /app/mini-app/dist ./mini-app/dist
COPY --from=build /app/server/package.json ./server/package.json
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
