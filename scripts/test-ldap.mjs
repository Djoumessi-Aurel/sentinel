#!/usr/bin/env node
/**
 * Vérifie la configuration Active Directory sans démarrer l'application.
 *
 * En développement, l'annuaire n'est pas joignable : `AUTH_MODE=dev` court-circuite
 * la vérification du mot de passe (docs/AUTH.md §4). Le réglage LDAP réel ne peut
 * donc être validé que sur une machine qui voit le domaine — d'où ce script, qui
 * fait le tour des trois questions qui se posent dans cet ordre :
 *
 *   1. le serveur répond-il ?
 *   2. le compte de service peut-il s'y connecter et lire ?
 *   3. un utilisateur donné peut-il s'authentifier ?
 *
 * Usage :
 *   npm run auth:test-ldap                 (dans apps/backend)
 *   npm run auth:test-ldap -- kamga        cherche « kamga » dans l'annuaire
 *   npm run auth:test-ldap -- kamga --login jkamga
 *                                          teste en plus la connexion de jkamga
 *
 * Aucun mot de passe n'est accepté en argument : il se retrouverait dans
 * l'historique du shell et dans la liste des processus. Celui de l'utilisateur
 * testé est demandé à la saisie, sans écho.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const vert = (t) => `\x1b[32m${t}\x1b[0m`;
const rouge = (t) => `\x1b[31m${t}\x1b[0m`;
const gris = (t) => `\x1b[90m${t}\x1b[0m`;
const ok = (t, d = '') => console.log(`  ${vert('OK')}    ${t}${d ? gris(` — ${d}`) : ''}`);
const ko = (t, d = '') => console.log(`  ${rouge('ECHEC')} ${t}${d ? gris(` — ${d}`) : ''}`);

// --- Arguments -------------------------------------------------------------

const args = process.argv.slice(2);
const indexLogin = args.indexOf('--login');
const utilisateurATester = indexLogin === -1 ? null : args[indexLogin + 1];
const fragment = args.filter((a, i) => a !== '--login' && i !== indexLogin + 1)[0] ?? null;

if (indexLogin !== -1 && !utilisateurATester) {
  console.error('--login attend un identifiant. Exemple : --login jkamga');
  process.exit(2);
}

// --- Configuration ---------------------------------------------------------

const requis = ['LDAP_URL', 'LDAP_BASE_DN', 'LDAP_DOMAIN', 'LDAP_USERNAME', 'LDAP_PASSWORD'];
const manquants = requis.filter((cle) => !process.env[cle]);

console.log('--- Configuration ---');
if (manquants.length > 0) {
  ko('variables présentes', `manquantes : ${manquants.join(', ')}`);
  console.log('');
  console.log('Renseigner ces variables dans le .env à la racine du dépôt.');
  console.log('Modèle disponible dans .env.example, détail dans docs/AUTH.md §5.');
  process.exit(1);
}
ok('variables présentes');
console.log(gris(`        URL      ${process.env.LDAP_URL}`));
console.log(gris(`        base DN  ${process.env.LDAP_BASE_DN}`));
console.log(gris(`        domaine  ${process.env.LDAP_DOMAIN}`));
console.log(gris(`        service  ${process.env.LDAP_USERNAME}`));

if (process.env.AUTH_MODE !== 'ldap') {
  console.log('');
  console.log(gris(`        Note : AUTH_MODE vaut « ${process.env.AUTH_MODE ?? 'dev'} ».`));
  console.log(gris("        Ce script interroge l'annuaire réel quand même, mais"));
  console.log(gris("        l'application, elle, n'y touchera pas tant que AUTH_MODE≠ldap."));
}

// --- Dépendances -----------------------------------------------------------
//
// Les filtres sont repris du code compilé de l'application plutôt que réécrits
// ici : l'échappement RFC 4515 est un point de sécurité, et deux copies
// finissent toujours par diverger.

const cheminFiltres = join(RACINE, 'apps/backend/dist/auth/directory/ldap-filter.js');
if (!existsSync(cheminFiltres)) {
  console.log('');
  ko('code compilé introuvable', 'lancer `npm run build --workspace @sentinel/backend` d’abord');
  process.exit(1);
}

const { buildPersonSearchFilter, buildUsernameFilter } = require(cheminFiltres);
const { Client } = require(join(RACINE, 'node_modules/ldapts'));

const TIMEOUT = Number(process.env.LDAP_TIMEOUT_MS ?? 10_000);
const nouveauClient = () =>
  new Client({ url: process.env.LDAP_URL, timeout: TIMEOUT, connectTimeout: TIMEOUT });

/** Ajoute le domaine si l'identifiant n'en porte pas déjà un. */
const enUPN = (identifiant) =>
  identifiant.includes('@') || identifiant.includes('\\')
    ? identifiant
    : `${identifiant}${process.env.LDAP_DOMAIN}`;

/** Saisie masquée : le mot de passe ne doit apparaître ni à l'écran ni dans un log. */
const demanderMotDePasse = (invite) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const sortie = process.stdout;
    const ecrire = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (chaine) => {
      if (chaine.includes(invite)) ecrire?.(chaine);
      else sortie.write('');
    };
    rl.question(invite, (reponse) => {
      rl.close();
      sortie.write('\n');
      resolve(reponse);
    });
  });

// --- 1. Connexion du compte de service -------------------------------------

console.log('');
console.log('--- Compte de service ---');

let client = nouveauClient();
try {
  await client.bind(enUPN(process.env.LDAP_USERNAME), process.env.LDAP_PASSWORD);
  ok('connexion au serveur et authentification du compte de service');
} catch (erreur) {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  ko('connexion du compte de service', message);
  console.log('');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) {
    console.log("Le serveur n'a pas répondu. Vérifier LDAP_URL, le pare-feu, et que");
    console.log('cette machine voit bien le domaine.');
  } else {
    console.log('Le serveur a répondu mais a refusé le compte : vérifier LDAP_USERNAME');
    console.log(`(essayé sous la forme « ${enUPN(process.env.LDAP_USERNAME)} ») et LDAP_PASSWORD.`);
  }
  await client.unbind().catch(() => {});
  process.exit(1);
}

// --- 2. Lecture de l'annuaire ----------------------------------------------

console.log('');
console.log('--- Lecture de l’annuaire ---');

const chercher = async (filtre, limite) => {
  const { searchEntries } = await client.search(process.env.LDAP_BASE_DN, {
    scope: 'sub',
    filter: filtre,
    sizeLimit: limite,
    attributes: ['sAMAccountName', 'displayName', 'cn', 'mail'],
  });
  return searchEntries;
};

try {
  const filtre = buildPersonSearchFilter(fragment ?? 'a');
  const entrees = await chercher(filtre, 10);
  ok('recherche exécutée', `${entrees.length} résultat(s) pour « ${fragment ?? 'a'} »`);

  if (entrees.length === 0) {
    console.log(gris('        Aucun résultat : vérifier LDAP_BASE_DN, ou essayer un autre fragment.'));
  }
  for (const entree of entrees.slice(0, 10)) {
    const identifiant = entree.sAMAccountName ?? '(sans sAMAccountName)';
    const nom = entree.displayName ?? entree.cn ?? '';
    const mail = entree.mail ? gris(` <${entree.mail}>`) : '';
    console.log(`        ${String(identifiant).padEnd(20)} ${nom}${mail}`);
  }
} catch (erreur) {
  ko('recherche', erreur instanceof Error ? erreur.message : String(erreur));
  console.log('');
  console.log('Le compte de service est connecté mais ne peut pas lire. Vérifier');
  console.log("LDAP_BASE_DN et les droits de lecture accordés à ce compte.");
  await client.unbind().catch(() => {});
  process.exit(1);
}

await client.unbind().catch(() => {});

// --- 3. Authentification d'un utilisateur ----------------------------------

if (utilisateurATester) {
  console.log('');
  console.log('--- Authentification d’un utilisateur ---');

  // On vérifie d'abord son existence, pour distinguer « identifiant inconnu »
  // de « mot de passe refusé » — les deux se présentent autrement de la même
  // façon, et on chercherait longtemps.
  client = nouveauClient();
  let existe = false;
  try {
    await client.bind(enUPN(process.env.LDAP_USERNAME), process.env.LDAP_PASSWORD);
    const entrees = await chercher(buildUsernameFilter(utilisateurATester), 1);
    existe = entrees.length > 0;
    if (existe) ok('identifiant trouvé dans l’annuaire', String(entrees[0].displayName ?? ''));
    else ko('identifiant trouvé dans l’annuaire', `« ${utilisateurATester} » est inconnu`);
  } catch (erreur) {
    ko('vérification de l’identifiant', erreur instanceof Error ? erreur.message : String(erreur));
  } finally {
    await client.unbind().catch(() => {});
  }

  if (existe) {
    const motDePasse = await demanderMotDePasse(`  Mot de passe de ${utilisateurATester} : `);
    if (motDePasse === '') {
      console.log(gris('        Saisie vide, test d’authentification ignoré.'));
    } else {
      client = nouveauClient();
      try {
        await client.bind(enUPN(utilisateurATester), motDePasse);
        ok('authentification réussie', `« ${enUPN(utilisateurATester)} » accepté par l’annuaire`);
      } catch (erreur) {
        const message = erreur instanceof Error ? erreur.message : String(erreur);
        const code = message.match(/data ([0-9a-fA-F]{3})/)?.[1]?.toLowerCase();
        const explications = {
          '52e': 'mot de passe incorrect',
          '525': 'utilisateur inexistant',
          530: 'connexion interdite à cette heure',
          531: 'connexion interdite depuis ce poste',
          532: 'mot de passe expiré',
          533: 'compte désactivé',
          701: 'compte expiré',
          773: 'mot de passe à changer',
          775: 'compte verrouillé',
        };
        ko('authentification', explications[code] ?? message);
      } finally {
        await client.unbind().catch(() => {});
      }
    }
  }
}

console.log('');
console.log('Configuration LDAP exploitable. Pour l’activer : AUTH_MODE=ldap.');
