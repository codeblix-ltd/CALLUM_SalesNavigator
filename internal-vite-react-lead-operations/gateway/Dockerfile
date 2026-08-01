FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false \
  && npm cache clean --force

COPY gateway ./gateway

RUN mkdir -p /var/lib/callum-codex \
  && chown -R node:node /app /var/lib/callum-codex

USER node
ENV CODEX_HOME=/var/lib/callum-codex
EXPOSE 8787
VOLUME ["/var/lib/callum-codex"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "gateway/server.mjs"]
