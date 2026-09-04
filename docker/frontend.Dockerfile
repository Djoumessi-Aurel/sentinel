# Image du frontend Next.js.
FROM node:22-alpine AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
# Les variables NEXT_PUBLIC_* sont figées à la compilation : elles doivent donc
# être présentes ici, et non seulement à l'exécution.
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/log-parsers/package.json packages/log-parsers/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/frontend/ apps/frontend/

RUN npm run build --workspace @sentinel/shared-types \
 && npm run build --workspace @sentinel/frontend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public

USER node
EXPOSE 3000
CMD ["node", "apps/frontend/server.js"]
