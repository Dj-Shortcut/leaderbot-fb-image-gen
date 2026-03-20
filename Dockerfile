FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build:docker

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Keep the runtime stage slim: copy only the bundled server entrypoint and static assets.
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/dist/public ./public

EXPOSE 8080
CMD ["node", "dist/index.cjs"]
