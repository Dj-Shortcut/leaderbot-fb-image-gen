FROM node:20-alpine

WORKDIR /app

RUN corepack enable

COPY package.json ./

RUN pnpm install --prod --no-frozen-lockfile

COPY index.ts ./

EXPOSE 8787

CMD ["pnpm", "start:proxy"]
