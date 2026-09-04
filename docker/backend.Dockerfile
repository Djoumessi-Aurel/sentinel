# Image du backend NestJS. Construction en plusieurs étapes : l'image finale ne
# contient ni sources TypeScript, ni dépendances de développement.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/log-parsers/package.json packages/log-parsers/
COPY apps/backend/package.json apps/backend/
# `npm ci` et non `npm install` : l'arbre de dépendances est celui, exact, du
# lockfile commité — aucune résolution surprise au moment du build
# (docs/SECURITY.md A08).
RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/backend/ apps/backend/

RUN npm run build --workspace @sentinel/shared-types \
 && npm run build --workspace @sentinel/log-parsers \
 && npx prisma generate --schema apps/backend/prisma/schema.prisma \
 && npm run build --workspace @sentinel/backend

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared-types/package.json packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/packages/log-parsers/package.json packages/log-parsers/
COPY --from=builder /app/packages/log-parsers/dist packages/log-parsers/dist
COPY --from=builder /app/apps/backend/package.json apps/backend/
COPY --from=builder /app/apps/backend/dist apps/backend/dist
COPY --from=builder /app/apps/backend/prisma apps/backend/prisma

RUN npm ci --omit=dev --workspaces --include-workspace-root \
 && npx prisma generate --schema apps/backend/prisma/schema.prisma \
 && npm cache clean --force

# Exécution sous un utilisateur non privilégié : une exécution en root donnerait
# à une compromission du processus les droits sur tout le conteneur.
USER node

EXPOSE 3001
# Les migrations sont appliquées au démarrage : le schéma ne peut pas diverger
# du code déployé.
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma && node apps/backend/dist/main.js"]
