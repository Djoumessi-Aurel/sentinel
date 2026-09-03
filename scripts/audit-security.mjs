#!/usr/bin/env node
/**
 * Porte de sécurité sur les dépendances (docs/SECURITY.md, OWASP A06).
 *
 * `npm audit` seul ne convient pas comme porte : il n'offre aucun moyen de
 * tracer une exception motivée, si bien qu'en pratique on finit par abaisser le
 * seuil ou par ignorer la sortie — ce qui revient à ne plus rien vérifier.
 *
 * Ce script échoue sur toute vulnérabilité `high` ou `critical`, sauf celles
 * explicitement listées dans `security-exceptions.json` avec une justification
 * et une date de revue. Une exception périmée fait échouer le script : une
 * dérogation ne doit jamais devenir permanente par oubli.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/** Point d'entrée JS de npm, fourni par npm lui-même quand on passe par un script. */
const NPM_CLI = process.env.npm_execpath ?? null;

function runAudit() {
  try {
    // `npm audit` sort en code non nul dès qu'une vulnérabilité existe :
    // on récupère la sortie JSON dans les deux cas.
    // On appelle le point d'entrée JavaScript de npm avec le Node courant,
    // plutôt que le lanceur `npm`/`npm.cmd` via un shell : passer des arguments
    // à un shell les concatène sans échappement, ce qui est précisément le genre
    // de raccourci que ce script est censé traquer. Node refuse d'ailleurs
    // désormais d'exécuter un `.cmd` hors shell.
    if (!NPM_CLI) {
      throw new Error("Chemin de la CLI npm introuvable : lancer ce script via `npm run audit:security`.");
    }
    return execFileSync(process.execPath, [NPM_CLI, 'audit', '--json'], {
      cwd: join(HERE, '..'),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim() !== '') return error.stdout;
    throw error;
  }
}

function loadExceptions() {
  const raw = readFileSync(join(HERE, 'security-exceptions.json'), 'utf8');
  const parsed = JSON.parse(raw);
  return new Map(parsed.exceptions.map((entry) => [entry.package, entry]));
}

const report = JSON.parse(runAudit());
const exceptions = loadExceptions();
const today = new Date().toISOString().slice(0, 10);

const blocking = [];
const tolerated = [];
const expired = [];

for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  if (!BLOCKING_SEVERITIES.has(vulnerability.severity)) continue;

  const exception = exceptions.get(name);
  if (!exception) {
    blocking.push({ name, severity: vulnerability.severity, range: vulnerability.range });
    continue;
  }

  if (exception.reviewBy < today) {
    expired.push({ name, reviewBy: exception.reviewBy });
  } else {
    tolerated.push({ name, reason: exception.reason, reviewBy: exception.reviewBy });
  }
}

for (const entry of tolerated) {
  console.log(`~ toléré  ${entry.name} — ${entry.reason} (à revoir avant le ${entry.reviewBy})`);
}
for (const entry of expired) {
  console.error(`! expiré  ${entry.name} — l'exception devait être revue avant le ${entry.reviewBy}`);
}
for (const entry of blocking) {
  console.error(`x bloqué  ${entry.name} (${entry.severity}) — versions ${entry.range}`);
}

if (blocking.length > 0 || expired.length > 0) {
  console.error(
    `\nAudit de sécurité en échec : ${blocking.length} vulnérabilité(s) non couverte(s), ${expired.length} exception(s) périmée(s).`,
  );
  console.error("Corriger la dépendance, ou motiver une exception dans scripts/security-exceptions.json.");
  process.exit(1);
}

console.log(`\nAudit de sécurité OK — aucune vulnérabilité high/critical non motivée (${tolerated.length} exception(s) active(s)).`);
