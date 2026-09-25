FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.16.1 --activate
COPY callum-v2/package.json callum-v2/pnpm-lock.yaml callum-v2/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY callum-v2/apps ./apps
COPY callum-v2/packages ./packages
EXPOSE 8788
CMD ["node", "apps/control-plane/server.mjs"]
