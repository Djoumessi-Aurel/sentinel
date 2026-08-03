# DEPLOYMENT.md

## 1. Environnement central (Docker Compose)

```yaml
# docker/docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: monitoring
      POSTGRES_USER: monitoring
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes: [pgdata:/var/lib/postgresql/data]

  opensearch:
    image: opensearchproject/opensearch:2
    environment:
      - discovery.type=single-node
      - plugins.security.disabled=true   # à sécuriser avant toute exposition publique
    volumes: [osdata:/usr/share/opensearch/data]

  backend:
    build: ../apps/backend
    environment:
      - DATABASE_URL=postgresql://monitoring:${POSTGRES_PASSWORD}@postgres:5432/monitoring
      - OPENSEARCH_URL=http://opensearch:9200
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASSWORD=${SMTP_PASSWORD}
      - SMS_GATEWAY_API_KEY=${SMS_GATEWAY_API_KEY}
      - AGENT_TOKEN_SECRET=${AGENT_TOKEN_SECRET}
    depends_on: [postgres, opensearch]
    ports: ["3001:3001"]

  frontend:
    build: ../apps/frontend
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:3001
      - NEXT_PUBLIC_WS_URL=ws://localhost:3001
    depends_on: [backend]
    ports: ["3000:3000"]

volumes:
  pgdata:
  osdata:
```

- Toutes les valeurs sensibles (`${...}`) viennent d'un fichier `.env` non
  commité (`.env.example` fourni avec des valeurs factices).
- En production, désactiver `plugins.security.disabled` sur OpenSearch et
  configurer un accès authentifié (hors périmètre détaillé ici, à traiter au
  moment du passage en prod réelle).

## 2. Agents de collecte (par serveur applicatif)

Un script d'installation par type d'appli dans `agents/` :
```
agents/
├── vector-templates/
│   ├── spring-boot.toml
│   ├── java-simple.toml
│   ├── nodejs-pm2.toml
│   └── react-nginx.toml
└── install.sh          # installe Vector, dépose le template adapté, configure le token
```

`install.sh <app_type> <application_id> <backend_url> <agent_token>` :
1. Installe Vector (binaire officiel) si absent.
2. Copie le template correspondant à `<app_type>`, en substituant
   `application_id`, `backend_url`, `agent_token` et les chemins de logs
   (demandés en paramètre ou valeurs par défaut par type).
3. Enregistre le service (systemd) pour démarrage automatique et reprise sur
   redémarrage serveur.

Chaque agent transporte un token machine-à-machine (`agent_token`), créé côté
backend via `IngestionAgentToken` (voir `DATA_MODEL.md`) au moment où
l'application est déclarée dans l'interface — le token est affiché une seule
fois à la création, à copier dans la commande d'installation.

## 3. Variables d'environnement (backend)

| Variable | Description |
|---|---|
| `DATABASE_URL` | connexion PostgreSQL |
| `OPENSEARCH_URL` | connexion OpenSearch |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | envoi d'emails d'alerte |
| `SMS_GATEWAY_API_KEY` | passerelle SMS (réutilisation de celle de distribcard si possible) |
| `AGENT_TOKEN_SECRET` | clé de hash des tokens d'agents |
| `ENCRYPTION_KEY` | (Phase 4) chiffrement des secrets TOTP — voir `AUTH.md` |

## 4. Environnement de développement

`docker-compose.dev.yml` : mêmes services + hot-reload backend/frontend
(volumes montés en bind mount, `nest start --watch` / `next dev`). Un agent
Vector de test peut tourner en local pour simuler un flux de logs sans
dépendre d'un vrai serveur applicatif (fichier de log généré par un script de
seed, suivi par Vector comme en production).
