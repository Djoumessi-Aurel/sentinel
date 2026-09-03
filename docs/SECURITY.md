# SECURITY.md — Conformité OWASP Top 10

Exigence produit : l'application doit respecter les règles de sécurité du
**OWASP Top 10 (édition 2021)**. Ce document traduit chaque catégorie en
mesures concrètes à implémenter et à vérifier dans ce dépôt. Il est de même
niveau d'autorité que les autres documents de `docs/` : en cas de conflit avec
une facilité d'implémentation, c'est ce document qui prime.

Sentinel supervise une production monétique. Une compromission n'exposerait pas
seulement l'outil, mais les **logs applicatifs de tout le parc** — donc
potentiellement des données de porteurs et des traces de transactions. Le
niveau d'exigence est celui d'une application bancaire interne, pas celui d'un
outil d'administration.

## A01 — Contrôle d'accès défaillant

| Mesure | Où |
|---|---|
| Aucune route sans garde, même en Phase 1 (`AuthGuard` stub) | `docs/AUTH.md §1`, tous les contrôleurs |
| Les routes d'ingestion utilisent un garde **distinct** (`AgentTokenGuard`), machine-à-machine | `IngestionModule` |
| Un token d'agent n'autorise que l'`applicationId` auquel il est rattaché : un agent compromis ne peut pas injecter dans une autre appli | `AgentTokenGuard` |
| Vérification systématique de l'appartenance d'une ressource imbriquée (`/services/:id`, `/rules/:id`) avant lecture ou écriture | services backend |
| Le frontend ne fait jamais foi : toute règle d'accès est revalidée côté serveur | — |

**Interdit** : exposer un identifiant technique dans une route sans vérifier
que l'appelant y a droit (référence directe non sécurisée).

## A02 — Défaillances cryptographiques

- Les tokens d'agent sont stockés **hashés** (SHA-256 avec sel applicatif via
  `AGENT_TOKEN_SECRET`), jamais en clair. Ils ne sont affichés qu'une fois, à
  la création (`docs/DEPLOYMENT.md §2`).
- Comparaison des tokens en **temps constant** (`crypto.timingSafeEqual`) pour
  éviter une attaque par mesure de temps.
- Aucun secret dans le code ni dans le dépôt : tout passe par des variables
  d'environnement, `.env` est dans `.gitignore`, `.env.example` ne contient
  que des valeurs factices.
- Phase 4 : secret TOTP chiffré au repos, mots de passe hashés en Argon2id ou
  bcrypt (jamais SHA seul).
- HTTPS obligatoire en production devant le backend et le frontend (terminaison
  TLS sur le reverse proxy, comme pour les autres applis du parc).

## A03 — Injection

- **SQL** : accès exclusivement via Prisma (requêtes paramétrées). Tout recours
  à `$queryRawUnsafe` est interdit ; `$queryRaw` balisé n'est admis que
  justifié en commentaire.
- **Recherche de logs** : les critères utilisateur sont passés en paramètres de
  requête typés, jamais concaténés dans une requête OpenSearch ou SQL.
- **Validation d'entrée systématique** : chaque DTO est validé par son schéma
  Zod de `packages/shared-types` avant d'atteindre la couche métier. Les champs
  inconnus sont rejetés (`whitelist` + `forbidNonWhitelisted`).
- **XSS côté frontend** : les lignes de log sont du contenu **hostile par
  nature** (elles viennent de systèmes tiers). Elles sont rendues comme texte,
  jamais via `dangerouslySetInnerHTML`.
- **Injection de log** : les retours chariot et séquences d'échappement ANSI
  sont neutralisés à l'ingestion, pour qu'une ligne forgée ne puisse pas
  falsifier l'affichage d'autres entrées.

## A04 — Conception non sécurisée

- Limites de ressources explicites sur l'ingestion : taille de lot, longueur de
  ligne, taille de corps HTTP (`INGESTION_LIMITS` dans `shared-types`). Sans
  cela, le endpoint le plus exposé est aussi un déni de service trivial.
- **Rate limiting** sur toutes les routes, avec un quota séparé et plus large
  pour l'ingestion (trafic machine légitime et soutenu).
- Le moteur de règles n'exécute jamais d'expression fournie par l'utilisateur :
  les analyseurs sont des classes enregistrées, paramétrées par des valeurs
  validées — pas d'évaluation dynamique de code ni de regex non bornée.
- Les regex de parsing sont écrites pour éviter le retour arrière catastrophique
  (ReDoS) : pas de quantificateurs imbriqués sur des classes qui se chevauchent.

## A05 — Mauvaise configuration de sécurité

- `helmet` activé sur le backend (en-têtes de sécurité, `X-Powered-By` retiré).
- **CORS restreint** à l'origine du frontend, via variable d'environnement.
  Jamais `origin: '*'` — y compris pour le WebSocket, dont l'origine est
  contrôlée de la même manière.
- Les réponses d'erreur ne divulguent ni pile d'appel ni détail interne : un
  filtre d'exception global renvoie un message générique et un identifiant de
  corrélation, le détail restant dans les logs serveur.
- OpenSearch et MySQL ne sont jamais exposés hors du réseau interne ;
  `plugins.security.disabled` d'OpenSearch doit être retiré avant toute mise en
  production (`docs/DEPLOYMENT.md §1`).
- Aucun compte ni mot de passe par défaut conservé.

## A06 — Composants vulnérables ou obsolètes

- `npm audit --audit-level=high` (`npm run audit:security`) doit passer avant
  chaque livraison, et les versions sont figées par `package-lock.json`.
- Pas de dépendance ajoutée sans nécessité réelle : chaque paquet est une
  surface d'attaque supplémentaire.
- Versions LTS supportées uniquement (Node ≥ 20.11, MySQL 8).

## A07 — Défaillances d'identification et d'authentification

- Phase 1-3 : il n'y a pas d'authentification utilisateur, **et c'est un risque
  assumé et documenté** — l'application ne doit donc pas être exposée hors du
  réseau interne tant que la Phase 4 n'est pas livrée. Ce point doit être
  rappelé à toute mise en service anticipée.
- Phase 4 : 2FA TOTP, limitation des tentatives, codes de récupération à usage
  unique (`docs/AUTH.md §2.4`).
- Les tokens d'agent sont révocables (`IngestionAgentToken.revokedAt`) : un
  serveur décommissionné se coupe sans redéploiement.

## A08 — Défaut d'intégrité des données et du logiciel

- `package-lock.json` commité, installations en `npm ci` sur les
  environnements automatisés.
- Le script `agents/install.sh` déposé sur les serveurs applicatifs vérifie
  l'empreinte du binaire Vector qu'il installe.
- Aucune désérialisation de données non fiables : les payloads d'ingestion sont
  du JSON validé, jamais des objets reconstruits dynamiquement.

## A09 — Carence des systèmes de journalisation et de supervision

Catégorie particulière ici : c'est le métier même de l'application.

- Le backend journalise ses propres événements de sécurité : token d'agent
  refusé, quota de débit atteint, échec de validation répété, modification de
  configuration.
- **Ne jamais journaliser un token, un mot de passe ou un secret**, même
  tronqué.
- Le principe « rien ne doit échouer silencieusement » (`docs/CLAUDE.md §5.4`)
  s'applique aussi à la sécurité : un agent qui cesse d'émettre déclenche une
  alerte de silence, ce qui couvre aussi le cas d'un agent volontairement coupé.
- **Masquage des données sensibles** avant stockage et affichage (numéros de
  carte, tokens, numéros de téléphone) — `RedactionModule`, appliqué à
  l'ingestion, donc avant persistance (`docs/LOG_PARSERS.md §6`).

## A10 — Falsification de requête côté serveur (SSRF)

- Le backend n'émet de requêtes sortantes que vers des hôtes issus de sa
  **configuration serveur** (SMTP, passerelle SMS, OpenSearch), jamais vers une
  URL fournie par un utilisateur ou présente dans une ligne de log.
- Si un jour une vérification de service de type `http` est ajoutée, l'URL
  cible devra être validée contre une liste d'hôtes autorisés, et les
  redirections désactivées.

## Vérification

- `npm run audit:security` — dépendances.
- Tests unitaires sur les points sensibles : validation des DTO, comparaison de
  token en temps constant, redaction, isolation d'un token à son application.
- Revue manuelle de cette liste avant chaque fin de phase.
