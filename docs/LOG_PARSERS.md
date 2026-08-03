# LOG_PARSERS.md

## 1. Objectif

Isoler toute la logique spécifique à un type d'appli dans un module
indépendant, pour que l'ajout d'un nouveau type n'implique jamais de modifier
le moteur d'ingestion, le moteur de règles, ou le frontend.

## 2. Interface

```ts
// packages/log-parsers/src/types.ts
export interface LogEntry {
  timestamp: string;       // ISO 8601 UTC
  level: LogLevel;         // 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'UNKNOWN'
  message: string;
  raw: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface LogParser {
  /** identifiant du type d'appli géré, ex: 'spring-boot' */
  readonly appType: string;

  /** parse une ligne brute ; retourne null si la ligne doit être ignorée
   *  (ex: ligne de stack trace multi-ligne déjà rattachée à l'entrée précédente) */
  parse(rawLine: string, context: { applicationId: string; server: string }): LogEntry | null;
}
```

## 3. Registre

```ts
// packages/log-parsers/src/registry.ts
class ParserRegistry {
  private parsers = new Map<string, LogParser>();
  register(parser: LogParser): void { this.parsers.set(parser.appType, parser); }
  get(appType: string): LogParser {
    const parser = this.parsers.get(appType);
    if (!parser) throw new Error(`Aucun parseur enregistré pour le type '${appType}'`);
    return parser;
  }
}
export const parserRegistry = new ParserRegistry();
```

Chaque parseur s'enregistre lui-même au chargement du module (fichier
`index.ts` du package qui importe et enregistre tous les parseurs connus).
**Ajouter un nouveau type d'appli = ajouter un fichier `xxx.parser.ts` +
une ligne d'enregistrement, sans toucher au reste du code.**

## 4. Parseurs à implémenter en Phase 1-2

### 4.1 Générique (fallback)
Utilisé si aucun parseur spécifique n'est trouvé, ou comme base pour les
nouveaux types. Détecte un niveau (`INFO`/`WARN`/`ERROR`/`DEBUG`) par une
regex simple sur la ligne, sinon `level: 'UNKNOWN'`, `message` = ligne
entière.

### 4.2 Spring Boot / Java simple
Format logback typique :
```
2026-03-13 10:15:32.123 INFO  [main] c.example.Service - message ici
```
- Regex : `^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+.*?-\s*(.*)$`
- Gestion des stack traces multi-lignes : une ligne qui ne matche pas le motif
  de début de ligne (pas de date en début) est rattachée au `message` de la
  dernière `LogEntry` émise pour cette appli (buffer par `applicationId` côté
  parseur ou côté module d'ingestion).
- Les deux scripts fournis par l'utilisateur pour **distribcard** montrent le
  format exact à supporter en priorité (colonne date en `$1`, niveau en `$3`).
  Un parseur dédié `distribcard.parser.ts` (spécialisation du parseur
  Spring Boot générique) ajoute l'extraction des motifs métier dans
  `metadata` :
  - `metadata.smsType = 'card' | 'pin'`
  - `metadata.outcome = 'success' | 'failure'`
  - détecté via les mêmes motifs que le script :
    - succès carte : `Notification envoyée avec succès pour la commande de carte`
    - échec carte : `SMS not sent for card availability` ou `card availability notification scheduler failed`
    - succès pin : `Notification envoyée avec succès pour la commande de code`
    - échec pin : `SMS not sent for pin availability` ou `pin availability notification scheduler failed`
  Ces `metadata` alimentent directement l'analyseur `pattern-rate` décrit
  dans `ALERTING.md`, qui reproduit le calcul du script (`taux = succès /
  (succès + échec) * 100`, alerte si `< seuil`).

### 4.3 Node.js (PM2)
- Logs PM2 par défaut : pas de niveau structuré à moins que l'appli logge en
  JSON (recommandé — voir `ARCHITECTURE.md` point sur le format structuré).
- Deux cas à supporter :
  - **JSON structuré** (préféré) : `{"level":"error","message":"...","timestamp":"..."}`
    → parsing direct, priorité sur le parsing texte.
  - **Texte libre** : fallback sur le parseur générique (détection de mots-clés
    `error`/`warn`/`info`, insensible à la casse).

### 4.4 React (Nginx)
- Deux sources à distinguer par le nom de fichier : `access.log` et
  `error.log`.
- `error.log` nginx : format `2026/03/13 10:15:32 [error] 1234#0: *1 message`
  → `level = 'ERROR'` si `[error]`, `WARN` si `[warn]`, sinon `INFO`.
- `access.log` : n'est pas une source d'erreur applicative en soi, mais utile
  pour un analyseur dédié (ex : taux de code HTTP 5xx) — voir `ALERTING.md`,
  type `pattern-rate` réutilisable ici aussi (regex sur le code de statut en
  fin de ligne du format combined nginx).

## 5. Ajouter un nouveau type d'appli (guide)

1. Créer `packages/log-parsers/src/<nouveau-type>.parser.ts` implémentant
   `LogParser`.
2. L'enregistrer dans `packages/log-parsers/src/index.ts`.
3. Ajouter un template Vector dans `agents/vector-templates/<nouveau-type>.toml`.
4. Aucune autre modification n'est nécessaire : le formulaire de création
   d'appli dans le frontend liste dynamiquement les types disponibles via
   `GET /api/applications/types` (endpoint qui retourne les clés enregistrées
   dans `parserRegistry`, à ajouter en Phase 2 si utile, sinon liste codée
   côté frontend synchronisée manuellement avec `packages/shared-types`).

## 6. Masquage de données sensibles

Avant d'écrire dans OpenSearch, chaque `LogEntry.message` passe par une étape
de redaction (module `RedactionModule`, appelé après le parsing, indépendant
du parseur) : liste de regex configurables (numéros de carte, tokens type
JWT/Bearer, numéros de téléphone) remplaçant les correspondances par `***`.
Liste par défaut fournie globalement, surchargeable par type d'appli si
nécessaire (Phase 3).
