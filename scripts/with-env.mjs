#!/usr/bin/env node
/**
 * Exécute une commande avec les variables du `.env` **racine** chargées.
 *
 * Le dépôt garde un seul fichier `.env`, à la racine : dupliquer un `.env` par
 * application les fait diverger, et un secret qui traîne dans deux fichiers est
 * un secret qu'on oublie de faire tourner dans l'un des deux
 * (docs/SECURITY.md A02).
 *
 * Usage : node scripts/with-env.mjs <commande> [arguments...]
 * Les variables déjà présentes dans l'environnement ne sont jamais écrasées,
 * pour qu'un réglage ponctuel en ligne de commande reste prioritaire.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Analyseur `.env` minimal : `CLE=valeur`, guillemets optionnels, `#` en commentaire. */
function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) {
  console.error(`Fichier ${envPath} introuvable. Copier .env.example en .env avant de continuer.`);
  process.exit(1);
}

const loaded = parseEnv(readFileSync(envPath, 'utf8'));
for (const [key, value] of Object.entries(loaded)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage : node scripts/with-env.mjs <commande> [arguments...]');
  process.exit(1);
}

// `shell: true` uniquement quand il est indispensable.
//
// Sous Windows, les binaires de `node_modules/.bin` sont des `.cmd`, que Node
// refuse de lancer sans shell. Mais passer par un shell concatène les arguments
// dans une ligne de commande au lieu de les transmettre tels quels : une valeur
// contenant `&`, `(` ou `|` s'y ferait interpréter. Or certains scripts
// reçoivent des arguments saisis à la main — un fragment de recherche pour
// `test-ldap.mjs`, par exemple.
//
// Ces scripts-là sont tous lancés par `node`, qui n'a pas besoin de shell : on
// l'invoque directement, et leurs arguments ne traversent aucune interprétation.
const besoinDeShell = command !== 'node' && command !== process.execPath;
const child = spawn(besoinDeShell ? command : process.execPath, args, {
  stdio: 'inherit',
  shell: besoinDeShell,
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on('error', (error) => {
  console.error(`Échec du lancement de « ${command} » : ${error.message}`);
  process.exit(1);
});
