#!/usr/bin/env node
/**
 * Simulateur d'agent de collecte, pour faire vivre l'application en local.
 *
 * Vector ne tourne pas sur le poste de développement (Windows, sans droits
 * admin — docs/DECISIONS.md D001). Ce script tient sa place : il émet des logs
 * réalistes et des vérifications de statut sur les **vraies** routes
 * d'ingestion, avec un **vrai** token d'agent. Ce n'est donc pas une maquette :
 * le chemin traversé est exactement celui de la production — garde, validation,
 * parsing, masquage, stockage, règles, WebSocket.
 *
 *   node scripts/simulate-agent.mjs [--app "filemanager"] [--interval 3000]
 *                                   [--error-rate 0.15] [--fail-service httpd.service]
 *
 * Sans --app, toutes les applications du parc émettent.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at === -1) continue;
    const key = trimmed.slice(0, at).trim();
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(at + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const API = (process.env.SENTINEL_API ?? 'http://localhost:3001').replace(/\/+$/, '') + '/api';
const ONLY_APP = option('app', null);
const INTERVAL = Number(option('interval', 3000));
const ERROR_RATE = Number(option('error-rate', 0.12));
const FAIL_SERVICE = option('fail-service', null);

/** Modèles de lignes par type d'appli, au format réel de chaque parseur. */
const TEMPLATES = {
  'spring-boot': {
    info: [
      'Traitement de début de journée démarré',
      'Fichier MAJ_CARTE_{n} déposé dans /online/EFT/outgo/host10008',
      'Connexion Active Directory établie pour l’utilisateur mxp',
      '{n} enregistrements traités en {ms} ms',
    ],
    warn: ['Reprise de la connexion JDBC après {n} tentative(s)', 'Fichier attendu absent, nouvel essai dans 60 s'],
    error: [
      'Échec du dépôt SFTP vers le serveur S2M : connexion refusée',
      'Timeout JDBC après 30 s sur localhost:3306',
      'Fichier Mperso illisible : format inattendu à la ligne {n}',
    ],
  },
  distribcard: {
    info: [
      'Notification envoyée avec succès pour la commande de carte {n}',
      'Notification envoyée avec succès pour la commande de code {n}',
      'Scheduler de distribution démarré',
    ],
    warn: ['SMS not sent for card availability', 'SMS not sent for pin availability'],
    error: ['card availability notification scheduler failed', 'pin availability notification scheduler failed'],
  },
  'nodejs-pm2': {
    info: [
      '{"level":"info","message":"Synchronisation Oracle terminée : {n} transactions","time":{epoch}}',
      '{"level":"info","message":"WebSocket : {n} client(s) connecté(s)","time":{epoch}}',
    ],
    warn: ['{"level":"warn","message":"Latence Oracle élevée : {ms} ms","time":{epoch}}'],
    error: ['{"level":"error","message":"Connexion Oracle CMSPROD refusée","time":{epoch}}'],
  },
  'react-nginx': {
    info: ['10.11.40.87 - - [{clf}] "GET /api/tpe/operations HTTP/1.1" 200 {n} "-" "Mozilla/5.0"'],
    warn: ['10.11.40.87 - - [{clf}] "GET /api/tpe/{n} HTTP/1.1" 404 231 "-" "Mozilla/5.0"'],
    error: ['10.11.40.87 - - [{clf}] "POST /api/tpe/operations HTTP/1.1" 502 137 "-" "Mozilla/5.0"'],
  },
};
TEMPLATES['java-simple'] = TEMPLATES['spring-boot'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomInt = (max) => Math.floor(Math.random() * max) + 1;

/** Horodatage local de la source : le backend le ramène en UTC (D003). */
function sourceTimestamp(offsetMinutes) {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString().replace('T', ' ').replace('Z', '');
}

function clfTimestamp(offsetMinutes) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (value) => String(value).padStart(2, '0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(date.getUTCDate())}/${months[date.getUTCMonth()]}/${date.getUTCFullYear()}:` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

function renderLine(type, level, offsetMinutes) {
  const templates = TEMPLATES[type] ?? TEMPLATES['spring-boot'];
  const body = pick(templates[level] ?? templates.info)
    .replace('{n}', String(randomInt(9999)))
    .replace('{ms}', String(randomInt(3000)))
    .replace('{epoch}', String(Date.now()))
    .replace('{clf}', clfTimestamp(offsetMinutes));

  // Les formats JSON et nginx portent déjà leur horodatage et leur niveau.
  if (type === 'nodejs-pm2' || type === 'react-nginx') return body;

  const label = level.toUpperCase().padEnd(5);
  return `${sourceTimestamp(offsetMinutes)} ${label} 1234 --- [main] c.gie.Service : ${body}`;
}

/** Une erreur Java arrive avec sa stack : le backend doit la rattacher à l'entrée. */
function stackTrace() {
  return [
    '\tat com.gie.service.TransferService.send(TransferService.java:142)',
    '\tat com.gie.scheduler.DailyJob.run(DailyJob.java:58)',
    '\tat java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144)',
  ];
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

async function main() {
  const offsetMinutes = Number(process.env.LOG_SOURCE_UTC_OFFSET_MINUTES ?? 0);

  const applications = await api('GET', '/applications');
  const targets = ONLY_APP ? applications.filter((app) => app.name === ONLY_APP) : applications;

  if (targets.length === 0) {
    console.error(ONLY_APP ? `Application « ${ONLY_APP} » introuvable.` : 'Aucune application : lancer `npm run db:seed`.');
    process.exit(1);
  }

  // Un token neuf par application : le token du seed n'est plus récupérable,
  // et c'est bien la propriété qu'on veut (il n'est affiché qu'une fois).
  const agents = [];
  for (const app of targets) {
    const { agentToken } = await api('POST', `/applications/${app.id}/tokens`);
    const services = await api('GET', `/applications/${app.id}/services`);
    agents.push({ app, token: agentToken, services });
    console.log(`Agent simulé prêt : ${app.name.padEnd(38)} ${services.length} service(s)`);
  }

  if (FAIL_SERVICE) {
    console.log(`\nLe service « ${FAIL_SERVICE} » sera remonté en échec, pour déclencher une alerte.`);
  }
  console.log(`\nÉmission toutes les ${INTERVAL} ms (Ctrl+C pour arrêter).\n`);

  let ticks = 0;

  const tick = async () => {
    ticks += 1;
    for (const agent of agents) {
      const lines = [];
      const level = Math.random() < ERROR_RATE ? 'error' : Math.random() < 0.25 ? 'warn' : 'info';
      lines.push({ raw: renderLine(agent.app.type, level, offsetMinutes) });

      if (level === 'error' && (agent.app.type === 'spring-boot' || agent.app.type === 'java-simple')) {
        for (const frame of stackTrace()) lines.push({ raw: frame });
      }

      try {
        await api('POST', '/ingestion/logs', { applicationId: agent.app.id, server: agent.app.serverName ?? 'local', lines }, agent.token);
      } catch (error) {
        console.error(`  ! logs ${agent.app.name} : ${error.message}`);
      }

      // Les vérifications de statut suivent leur propre cadence (30 s en
      // production) : on les émet toutes les 10 itérations.
      if (agent.services.length > 0 && ticks % 10 === 1) {
        const checkedAt = new Date().toISOString();
        const checks = agent.services.map((service) => ({
          serviceName: service.name,
          state: FAIL_SERVICE && service.name === FAIL_SERVICE ? 'failed' : 'active',
          checkedAt,
        }));
        try {
          await api('POST', '/ingestion/status', { applicationId: agent.app.id, server: agent.app.serverName ?? 'local', checks }, agent.token);
        } catch (error) {
          console.error(`  ! statut ${agent.app.name} : ${error.message}`);
        }
      }
    }
    process.stdout.write(`\r  ${ticks} itération(s) émise(s) sur ${agents.length} application(s)   `);
  };

  await tick();
  setInterval(() => void tick(), INTERVAL);
}

main().catch((error) => {
  console.error(error.message);
  console.error('\nLe backend est-il démarré ? (npm run dev:backend)');
  process.exit(1);
});
