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

# Optional: the agy CLI, for GEMINI_BACKEND=agy (see README). Off by default so
# an API-key deploy stays lean and builds without reaching Google's installer.
ARG INSTALL_AGY=false
RUN if [ "$INSTALL_AGY" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
      && curl -fsSL https://antigravity.google/cli/install.sh | bash \
      && ln -s /root/.local/bin/agy /usr/local/bin/agy \
      && rm -rf /var/lib/apt/lists/*; \
    fi

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/mini-app/dist ./mini-app/dist
COPY --from=build /app/server/package.json ./server/package.json
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
