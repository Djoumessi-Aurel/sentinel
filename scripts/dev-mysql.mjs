#!/usr/bin/env node
/**
 * MySQL 8 local, en installation standalone et sans droits administrateur.
 *
 * Le poste de développement n'a ni Docker ni droits admin (docs/DECISIONS.md D001).
 * Ce script initialise et pilote une instance MySQL isolée dans `.data/mysql`,
 * sur un port dédié, sans toucher à un éventuel MySQL déjà installé.
 *
 *   node scripts/dev-mysql.mjs init     initialise le répertoire de données
 *   node scripts/dev-mysql.mjs start    démarre l'instance (init automatique si besoin)
 *   node scripts/dev-mysql.mjs stop     arrête l'instance
 *   node scripts/dev-mysql.mjs status   indique si l'instance répond
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, '.data', 'mysql');
const LOG_FILE = join(ROOT, '.data', 'mysql.log');
const PID_FILE = join(ROOT, '.data', 'mysql.pid');

const MYSQL_HOME = process.env.MYSQL_HOME ?? 'C:/Users/adjoumessi/tools/mysql-8.0.46-winx64';
const PORT = Number(process.env.DEV_MYSQL_PORT ?? 3307);
const DB_NAME = 'sentinel';
const DB_USER = 'sentinel';
const DB_PASSWORD = 'sentinel';

const exe = (name) => join(MYSQL_HOME, 'bin', process.platform === 'win32' ? `${name}.exe` : name);

function requireBinaries() {
  for (const name of ['mysqld', 'mysql']) {
    if (!existsSync(exe(name))) {
      console.error(`Binaire introuvable : ${exe(name)}`);
      console.error('Définir MYSQL_HOME sur le dossier de MySQL 8 standalone.');
      process.exit(1);
    }
  }
}

/** Le port répond-il ? Plus fiable qu'un fichier PID, qui survit à un arrêt brutal. */
function isListening(timeoutMs = 1000) {
  return new Promise((done) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT });
    const finish = (result) => {
      socket.destroy();
      done(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitUntil(predicate, { attempts, delayMs, label }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await predicate()) return true;
    await wait(delayMs);
  }
  console.error(`Délai dépassé : ${label}`);
  return false;
}

function runSql(sql, { user = 'root' } = {}) {
  return execFileSync(exe('mysql'), ['--protocol=TCP', '-h', '127.0.0.1', '-P', String(PORT), '-u', user, '-e', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function init() {
  requireBinaries();
  if (existsSync(join(DATA_DIR, 'mysql'))) {
    console.log('Répertoire de données déjà initialisé.');
    return;
  }
  mkdirSync(dirname(DATA_DIR), { recursive: true });
  rmSync(DATA_DIR, { recursive: true, force: true });

  console.log(`Initialisation de MySQL dans ${DATA_DIR} ...`);
  // `--initialize-insecure` : compte root sans mot de passe. Acceptable ici et
  // seulement ici : instance de développement, liée à la boucle locale, sur un
  // port dédié, jamais déployée. La production passe par docker-compose avec
  // des mots de passe issus du .env (docs/DEPLOYMENT.md §1).
  execFileSync(exe('mysqld'), [`--datadir=${DATA_DIR}`, `--basedir=${MYSQL_HOME}`, '--initialize-insecure'], {
    stdio: 'inherit',
  });
  console.log('Initialisation terminée.');
}

async function start() {
  requireBinaries();
  if (await isListening()) {
    console.log(`MySQL répond déjà sur le port ${PORT}.`);
    return;
  }
  init();

  console.log(`Démarrage de MySQL sur le port ${PORT} ...`);
  const child = spawn(
    exe('mysqld'),
    [
      `--datadir=${DATA_DIR}`,
      `--basedir=${MYSQL_HOME}`,
      `--port=${PORT}`,
      '--bind-address=127.0.0.1',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
      `--log-error=${LOG_FILE}`,
      // Pas de --skip-name-resolve : le compte root créé par
      // --initialize-insecure est root@localhost, et sans résolution de nom
      // une connexion TCP sur 127.0.0.1 ne correspond pas à « localhost ».
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  const up = await waitUntil(() => isListening(), {
    attempts: 60,
    delayMs: 1000,
    label: `MySQL n'écoute toujours pas sur le port ${PORT}. Voir ${LOG_FILE}.`,
  });
  if (!up) {
    if (existsSync(LOG_FILE)) console.error(readFileSync(LOG_FILE, 'utf8').split('\n').slice(-20).join('\n'));
    process.exit(1);
  }

  // Le serveur écoute, mais peut encore refuser les connexions le temps de finir
  // son initialisation interne : on attend qu'une requête aboutisse réellement.
  const ready = await waitUntil(
    () => {
      try {
        runSql('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    { attempts: 30, delayMs: 1000, label: "MySQL écoute mais n'accepte pas encore de requête." },
  );
  if (!ready) process.exit(1);

  provision();
  console.log(`MySQL prêt : mysql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`);
}

function provision() {
  runSql(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  runSql(`CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}'`);
  // Prisma crée une base fantôme pour calculer les migrations : les droits
  // doivent donc dépasser la seule base applicative.
  runSql(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}_shadow\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  runSql(`GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%'`);
  runSql(`GRANT ALL PRIVILEGES ON \`${DB_NAME}_shadow\`.* TO '${DB_USER}'@'%'`);
  runSql('FLUSH PRIVILEGES');
  console.log(`Base « ${DB_NAME} » et utilisateur « ${DB_USER} » prêts.`);
}

async function stop() {
  requireBinaries();
  if (!(await isListening())) {
    console.log('MySQL ne tourne pas.');
    return;
  }
  try {
    execFileSync(exe('mysqladmin'), ['--protocol=TCP', '-h', '127.0.0.1', '-P', String(PORT), '-u', 'root', 'shutdown'], {
      stdio: 'inherit',
    });
  } catch {
    console.error("Arrêt propre impossible ; vérifier le processus mysqld manuellement.");
    process.exit(1);
  }
  await waitUntil(async () => !(await isListening()), { attempts: 30, delayMs: 500, label: "MySQL ne s'est pas arrêté." });
  rmSync(PID_FILE, { force: true });
  console.log('MySQL arrêté.');
}

async function status() {
  const up = await isListening();
  console.log(up ? `MySQL répond sur le port ${PORT}.` : `Aucun MySQL sur le port ${PORT}.`);
  process.exit(up ? 0 : 1);
}

const command = process.argv[2] ?? 'start';
const actions = { init, start, stop, status };
const action = actions[command];

if (!action) {
  console.error(`Commande inconnue « ${command} ». Attendu : init | start | stop | status.`);
  process.exit(1);
}

await action();
