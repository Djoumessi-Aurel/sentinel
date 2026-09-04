# Sentinel

Supervision des logs et du statut des services du parc applicatif monétique du
GIE GCB. L'objectif : détecter une panne **avant** qu'un utilisateur ne la
signale.

Les spécifications font foi et vivent dans [`docs/`](docs/) — commencer par
[`docs/CLAUDE.md`](docs/CLAUDE.md).

## Démarrage rapide (poste de développement, sans Docker)

Le poste de développement n'a pas les droits administrateur : tout tourne avec
des binaires standalone, sans Docker ni OpenSearch
(voir [`docs/DECISIONS.md`](docs/DECISIONS.md), D001 et D002).

```bash
npm ci                       # installe tout le monorepo
cp .env.example .env         # puis générer AGENT_TOKEN_SECRET (voir le fichier)

npm run dev:mysql            # MySQL 8 standalone dans .data/mysql, port 3307
npm run db:migrate           # applique les migrations Prisma
npm run db:seed              # charge le parc réel : 10 applis, 25 services

npm run dev:backend          # API + WebSocket sur http://localhost:3001
npm run dev:frontend         # interface sur http://localhost:3000
```

Sans agent réel sur un serveur, un simulateur fait vivre l'application en
émettant des logs et des vérifications de statut sur les **vraies** routes
d'ingestion, avec un **vrai** token :

```bash
npm run simulate                                    # toutes les applications
npm run simulate -- --app filemanager --fail-service httpd.service
```

Prérequis : Node ≥ 20.11 et MySQL 8 standalone. Le chemin de MySQL est
configurable par la variable `MYSQL_HOME` (par défaut
`C:\Users\adjoumessi\tools\mysql-8.0.46-winx64`).

## Organisation

```
apps/backend        NestJS — ingestion, parsing, règles, alertes, temps réel
apps/frontend       Next.js 16 — dashboard, viewer temps réel, configuration
packages/shared-types   contrats API et WebSocket (types + schémas Zod)
packages/log-parsers    registre de parseurs, un par type d'application
agents/             templates Vector et scripts déposés sur les serveurs
docker/             cible de déploiement serveur
scripts/            outils de développement (MySQL local, audit, simulateur)
docs/               spécifications — font foi
```

## Commandes utiles

| Commande | Rôle |
|---|---|
| `npm test` | tests unitaires de tous les paquets |
| `npm run typecheck` | vérification des types |
| `npm run audit:security` | porte d'audit des dépendances (OWASP A06) |
| `npm run dev:mysql:stop` | arrête l'instance MySQL locale |
| `npm run db:seed` | recharge le parc (idempotent) |

## Ce qui est en place

Phase 1 de la feuille de route ([`docs/CLAUDE.md`](docs/CLAUDE.md) §7), et une
partie des phases 2 et 3 qui en découlait naturellement :

- ingestion authentifiée par token d'agent, **borné à son application** ;
- parseurs générique, Spring Boot, Java simple, distribcard, Node/PM2,
  React/Nginx, avec rattachement des stack traces ;
- masquage des données sensibles **avant** persistance (PAN validé par Luhn,
  secrets, jetons, téléphones) ;
- stockage des logs derrière une interface, adaptateurs MySQL et OpenSearch ;
- cinq analyseurs : `level-threshold`, `pattern-rate`, `silence`,
  `service-status`, `service-silence` ;
- canaux visuel, sonore, email et SMS, indépendants, avec anti-spam, heures
  creuses et historique d'envoi par canal ;
- diffusion temps réel par WebSocket, par application ;
- services surveillés, avec création automatique de leurs règles ;
- écrans : tableau de bord, temps réel, historique, services, alertes,
  configuration globale, généralisation.

## Sécurité

L'application supervise une production monétique : ses logs peuvent contenir des
données de porteurs. [`docs/SECURITY.md`](docs/SECURITY.md) traduit chaque
catégorie du OWASP Top 10 en mesures concrètes, et fait autorité au même titre
que les autres documents.

> **L'authentification des utilisateurs n'est pas encore implémentée** (Phase 4,
> voir [`docs/AUTH.md`](docs/AUTH.md)). Jusque-là, l'application ne doit pas être
> exposée hors du réseau interne. Un bandeau le rappelle dans l'interface.
