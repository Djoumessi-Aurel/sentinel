// Vérifie l'authentification de bout en bout : routes protégées, comptes
// techniques, rôles, gestion des utilisateurs et étape préalable à l'annuaire.
//
// Se lance contre un backend démarré : `npm run qa:auth`.
import { createRequire } from 'node:module';

const API = 'http://localhost:3001/api';

// Deux personnes de l'annuaire fictif, une par rôle non administrateur.
const LECTEUR = 'jkamga';
const SUPERVISEUR = 'mnkolo';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

let cookieCourant = null;

const appel = async (methode, chemin, corps, entetesSup = {}) => {
  const reponse = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieCourant ? { Cookie: cookieCourant } : {}),
      ...entetesSup,
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
    redirect: 'manual',
  });

  const brut = reponse.headers.getSetCookie?.() ?? [];
  const session = brut.find((c) => c.startsWith('sentinel_session='));
  if (session) cookieCourant = session.split(';')[0];

  const texte = await reponse.text();
  let donnees;
  try {
    donnees = texte === '' ? null : JSON.parse(texte);
  } catch {
    donnees = texte;
  }
  return { statut: reponse.status, donnees, entetes: brut };
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Connexion tenace : la protection anti-force brute limite à cinq tentatives par
 * minute, et ce scénario en enchaîne davantage. On patiente plutôt que de
 * conclure à tort à un échec — la limitation est un comportement voulu, vérifié
 * explicitement plus bas.
 *
 * L'attente couvre la **fenêtre entière**. Réessayer plus tôt ne fait que
 * réalimenter le compteur : le blocage ne se lèverait jamais.
 */
const connexion = async (username, password) => {
  for (let essai = 0; essai < 3; essai += 1) {
    const r = await appel('POST', '/auth/login', { username, password });
    if (r.statut !== 429) return r;
    console.log('        (limite de tentatives atteinte, attente de la fenêtre…)');
    await attendre(62_000);
  }
  return { statut: 429, donnees: null, entetes: [] };
};

const resultats = [];
const verifier = (libelle, condition, detail = '') => {
  resultats.push(condition);
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${libelle}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Remise à zéro.
 *
 * L'API ne permet plus de supprimer un utilisateur — c'est voulu, on désactive
 * (docs/AUTH.md §2) — mais un scénario doit pouvoir repartir d'une base propre,
 * sinon la deuxième exécution échouerait sur des ajouts déjà faits. On passe
 * donc par la base, comme n'importe quelle préparation de test.
 */
const remiseAZero = async () => {
  await prisma.user.deleteMany({ where: { username: { in: [LECTEUR, SUPERVISEUR] } } });
};

await remiseAZero();

console.log('--- Sans session ---');
let r = await appel('GET', '/applications');
verifier('les applications sont refusées', r.statut === 401, `HTTP ${r.statut}`);
r = await appel('GET', '/health');
verifier('la sonde de disponibilité reste accessible', r.statut === 200);
r = await appel('GET', '/auth/status');
verifier("l'état de l'authentification est accessible", r.statut === 200, JSON.stringify(r.donnees));

console.log('');
console.log('--- Comptes techniques ---');
r = await connexion('sentineladmin', 'mauvais');
verifier('mot de passe incorrect refusé', r.statut === 401, r.donnees?.message);
r = await connexion('inconnu', 'x');
verifier('utilisateur inconnu refusé', r.statut === 401);
verifier(
  'le message ne distingue pas les deux cas',
  r.donnees?.message === 'Identifiants incorrects ou accès non autorisé',
  r.donnees?.message,
);

r = await connexion('sentineladmin', 'sentinel-admin-dev-2026');
verifier('super administrateur connecté', r.statut === 200 && r.donnees?.role === 'admin', JSON.stringify(r.donnees));
verifier('le cookie de session est HttpOnly', (r.entetes[0] ?? '').includes('HttpOnly'));
verifier('le cookie est SameSite=Lax', (r.entetes[0] ?? '').toLowerCase().includes('samesite=lax'));

r = await appel('GET', '/applications');
verifier('les applications deviennent accessibles', r.statut === 200, `${r.donnees?.length ?? 0} application(s)`);
const applications = r.donnees ?? [];
verifier(
  'un administrateur voit les chemins des fichiers de logs',
  applications.length === 0 || typeof applications[0].logPath === 'string',
  applications[0]?.logPath ?? '(aucune application)',
);
const applicationTemoin = applications[0] ?? null;

console.log('');
console.log('--- Recherche dans l’annuaire et ajout d’utilisateurs ---');
r = await appel('GET', '/users/directory?q=a');
verifier('recherche trop courte refusée', r.statut === 400);
r = await appel('GET', '/users/directory?q=ka');
verifier('recherche par fragment de nom', r.statut === 200 && r.donnees.length > 0, JSON.stringify(r.donnees?.[0]));

r = await appel('POST', '/users', { username: 'nexistepas', role: 'viewer' });
verifier("un identifiant absent de l'annuaire est refusé", r.statut === 400, r.donnees?.message);

r = await appel('POST', '/users', { username: 'sentineladmin', role: 'admin' });
verifier('un compte technique ne peut pas être ajouté', r.statut === 400, r.donnees?.message);

r = await appel('POST', '/users', { username: LECTEUR, role: 'viewer' });
const lecteur = r.donnees;
verifier('ajout d’un lecteur depuis l’annuaire', r.statut === 201 && lecteur?.username === LECTEUR, JSON.stringify(lecteur));
verifier('le nom affiché vient de l’annuaire', lecteur?.displayName === 'Jean Kamga');

r = await appel('POST', '/users', { username: SUPERVISEUR, role: 'superviseur' });
const superviseur = r.donnees;
verifier(
  'ajout d’un superviseur',
  r.statut === 201 && superviseur?.role === 'superviseur',
  JSON.stringify(superviseur),
);

r = await appel('POST', '/users', { username: LECTEUR, role: 'viewer' });
verifier('un doublon est refusé', r.statut === 400, r.donnees?.message);

r = await appel('POST', '/users', { username: 'pfotso', role: 'roi' });
verifier('un rôle inconnu est refusé', r.statut === 400, r.donnees?.message);

console.log('');
console.log('--- Le lecteur ---');
r = await connexion(LECTEUR, 'peu importe en mode dev');
verifier('connexion du lecteur', r.statut === 200 && r.donnees?.role === 'viewer', JSON.stringify(r.donnees));

r = await appel('GET', '/applications');
verifier('un lecteur peut lire', r.statut === 200);
verifier(
  'les chemins des fichiers de logs lui sont masqués',
  (r.donnees ?? []).every((app) => app.logPath === null),
  JSON.stringify((r.donnees ?? [])[0] ?? {}).slice(0, 120),
);

if (applicationTemoin) {
  r = await appel('GET', `/applications/${applicationTemoin.id}`);
  verifier('masqué aussi sur le détail d’une application', r.statut === 200 && r.donnees?.logPath === null);
}

r = await appel('POST', '/servers', { name: 'interdit', host: '10.0.0.1' });
verifier('un lecteur ne peut pas écrire', r.statut === 403, r.donnees?.message);
r = await appel('GET', '/users');
verifier('un lecteur ne voit pas la liste des utilisateurs', r.statut === 403);

// Le contrôle de rôle passe avant le traitement : un identifiant d'alerte
// inexistant suffit à distinguer « droit refusé » (403) de « droit accordé »
// (404, l'alerte n'existe pas). Le scénario n'a donc pas besoin d'une vraie
// alerte active, qui dépendrait de l'état de la base.
const ALERTE_FICTIVE = '00000000-0000-4000-8000-000000000000';
r = await appel('PATCH', `/alerts/${ALERTE_FICTIVE}/resolve`);
verifier('un lecteur ne peut pas résoudre une alerte', r.statut === 403, r.donnees?.message);

console.log('');
console.log('--- Le superviseur ---');
r = await connexion(SUPERVISEUR, 'peu importe en mode dev');
verifier('connexion du superviseur', r.statut === 200 && r.donnees?.role === 'superviseur', JSON.stringify(r.donnees));

r = await appel('GET', '/applications');
verifier(
  'un superviseur voit les chemins des fichiers de logs',
  r.statut === 200 && (r.donnees ?? []).every((app) => typeof app.logPath === 'string'),
  (r.donnees ?? [])[0]?.logPath ?? '(aucune application)',
);

r = await appel('PATCH', `/alerts/${ALERTE_FICTIVE}/resolve`);
verifier(
  'un superviseur peut résoudre une alerte',
  r.statut !== 403,
  `HTTP ${r.statut} (403 = refusé, 404 = droit accordé mais alerte inexistante)`,
);
verifier('une alerte inexistante rend 404, pas 500', r.statut === 404, `HTTP ${r.statut}`);

r = await appel('POST', '/servers', { name: 'interdit', host: '10.0.0.1' });
verifier('un superviseur ne peut pas administrer', r.statut === 403, r.donnees?.message);
r = await appel('GET', '/users');
verifier('un superviseur ne gère pas les utilisateurs', r.statut === 403);

console.log('');
console.log('--- Désactivation, et absence de suppression ---');
const reconnexionAdmin = await connexion('sentineladmin', 'sentinel-admin-dev-2026');
r = await appel('PATCH', `/users/${lecteur.id}`, { enabled: false });
verifier(
  'désactivation par un administrateur',
  r.statut === 200 && r.donnees?.enabled === false,
  `reconnexion HTTP ${reconnexionAdmin.statut} / patch HTTP ${r.statut}`,
);

r = await appel('DELETE', `/users/${superviseur.id}`);
verifier('la suppression d’un utilisateur n’existe pas', r.statut === 404, `HTTP ${r.statut}`);

r = await connexion(LECTEUR, 'x');
verifier('un compte désactivé ne peut plus se connecter', r.statut === 401, `HTTP ${r.statut} ${r.donnees?.message ?? ''}`);

console.log('');
console.log('--- Compte d’affichage ---');
r = await connexion('sentineluser', 'sentinel-ecran-dev-2026');
verifier("l'écran se connecte en lecteur", r.statut === 200 && r.donnees?.role === 'viewer');
verifier('il est marqué comme compte technique', r.donnees?.builtin === true);
const dureeCookie = Number((r.entetes[0] ?? '').match(/Max-Age=(\d+)/)?.[1] ?? 0);
verifier('sa session est de longue durée', dureeCookie > 7 * 86400, `${Math.round(dureeCookie / 86400)} jours`);

r = await appel('GET', '/users');
verifier("l'écran ne peut pas administrer", r.statut === 403);

r = await appel('POST', '/auth/logout');
verifier('déconnexion', r.statut === 204);

console.log('');
console.log('--- Protection contre la force brute ---');
let bloque = false;
for (let essai = 0; essai < 10; essai += 1) {
  const tentative = await appel('POST', '/auth/login', { username: 'sentineladmin', password: 'faux' });
  if (tentative.statut === 429) {
    bloque = true;
    break;
  }
}
verifier('les tentatives répétées finissent bloquées', bloque, '429 après quelques essais');

// `X-Forwarded-For` est fourni par le client : si la clé de quota en dérivait,
// il suffirait d'en changer à chaque essai pour tenter les mots de passe sans
// limite. Le blocage doit tenir malgré une adresse annoncée différente.
let contourne = false;
for (let essai = 0; essai < 6; essai += 1) {
  const tentative = await appel(
    'POST',
    '/auth/login',
    { username: 'sentineladmin', password: 'faux' },
    { 'X-Forwarded-For': `203.0.113.${essai + 1}` },
  );
  if (tentative.statut !== 429) contourne = true;
}
verifier(
  'la limite ne se contourne pas en changeant d’en-tête X-Forwarded-For',
  !contourne,
  contourne ? 'des tentatives sont passées' : 'toujours 429',
);

await remiseAZero();
await prisma.$disconnect();

const succes = resultats.every(Boolean);
console.log('');
console.log(`${resultats.filter(Boolean).length}/${resultats.length} vérifications passées`);
console.log(succes ? 'RESULTAT : authentification FONCTIONNELLE' : 'RESULTAT : ECHEC');
process.exit(succes ? 0 : 1);
