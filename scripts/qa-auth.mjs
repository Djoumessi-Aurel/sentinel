// Vérifie l'authentification de bout en bout : routes protégées, comptes
// techniques, rôles, gestion des utilisateurs et étape préalable à l'annuaire.
const API = 'http://localhost:3001/api';

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

// Le scénario ajoute puis désactive un utilisateur de test. S'il subsiste d'un
// run précédent, la création échoue et tout ce qui en dépend s'écroule : on
// repart donc d'une base propre plutôt que d'un état hérité.
const nettoyagePrealable = await connexion('sentineladmin', 'sentinel-admin-dev-2026');
if (nettoyagePrealable.statut === 200) {
  const liste = await appel('GET', '/users');
  for (const u of liste.donnees ?? []) {
    if (u.username === 'jkamga') await appel('DELETE', `/users/${u.id}`);
  }
  await appel('POST', '/auth/logout');
}
cookieCourant = null;

console.log('--- Sans session ---');
let r = await appel('GET', '/applications');
verifier('les applications sont refusées', r.statut === 401, `HTTP ${r.statut}`);
r = await appel('GET', '/health');
verifier('la sonde de disponibilité reste accessible', r.statut === 200);
r = await appel('GET', '/auth/status');
verifier("l'état de l'authentification est accessible", r.statut === 200, JSON.stringify(r.donnees));

console.log('');
console.log('--- Comptes techniques ---');
r = await appel('POST', '/auth/login', { username: 'sentineladmin', password: 'mauvais' });
verifier('mot de passe incorrect refusé', r.statut === 401, r.donnees?.message);
r = await appel('POST', '/auth/login', { username: 'inconnu', password: 'x' });
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

console.log('');
console.log('--- Recherche dans l’annuaire et ajout d’un utilisateur ---');
r = await appel('GET', '/users/directory?q=a');
verifier('recherche trop courte refusée', r.statut === 400);
r = await appel('GET', '/users/directory?q=ka');
verifier('recherche par fragment de nom', r.statut === 200 && r.donnees.length > 0, JSON.stringify(r.donnees?.[0]));

r = await appel('POST', '/users', { username: 'nexistepas', role: 'viewer' });
verifier("un identifiant absent de l'annuaire est refusé", r.statut === 400, r.donnees?.message);

r = await appel('POST', '/users', { username: 'sentineladmin', role: 'admin' });
verifier('un compte technique ne peut pas être ajouté', r.statut === 400, r.donnees?.message);

r = await appel('POST', '/users', { username: 'jkamga', role: 'viewer' });
const utilisateur = r.donnees;
verifier('ajout depuis l’annuaire', r.statut === 201 && utilisateur?.username === 'jkamga', JSON.stringify(utilisateur));
verifier('le nom affiché vient de l’annuaire', utilisateur?.displayName === 'Jean Kamga');

r = await appel('POST', '/users', { username: 'jkamga', role: 'viewer' });
verifier('un doublon est refusé', r.statut === 400, r.donnees?.message);

console.log('');
console.log('--- Connexion d’un utilisateur déclaré, et rôles ---');
r = await connexion('jkamga', 'peu importe en mode dev');
verifier('connexion du lecteur', r.statut === 200 && r.donnees?.role === 'viewer', JSON.stringify(r.donnees));

r = await appel('GET', '/applications');
verifier('un lecteur peut lire', r.statut === 200);
r = await appel('POST', '/servers', { name: 'interdit', host: '10.0.0.1' });
verifier('un lecteur ne peut pas écrire', r.statut === 403, r.donnees?.message);
r = await appel('GET', '/users');
verifier('un lecteur ne voit pas la liste des utilisateurs', r.statut === 403);

console.log('');
console.log('--- Désactivation ---');
const reconnexionAdmin = await connexion('sentineladmin', 'sentinel-admin-dev-2026');
r = await appel('PATCH', `/users/${utilisateur.id}`, { enabled: false });
verifier(
  'désactivation par un administrateur',
  r.statut === 200 && r.donnees?.enabled === false,
  `reconnexion HTTP ${reconnexionAdmin.statut} / patch HTTP ${r.statut} ${JSON.stringify(r.donnees)}`,
);

r = await connexion('jkamga', 'x');
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

console.log('');
console.log('--- Nettoyage ---');
await connexion('sentineladmin', 'sentinel-admin-dev-2026');
r = await appel('DELETE', `/users/${utilisateur.id}`);
verifier('suppression de l’utilisateur de test', r.statut === 204, `HTTP ${r.statut} ${JSON.stringify(r.donnees)}`);

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

const succes = resultats.every(Boolean);
console.log('');
console.log(`${resultats.filter(Boolean).length}/${resultats.length} vérifications passées`);
console.log(succes ? 'RESULTAT : authentification FONCTIONNELLE' : 'RESULTAT : ECHEC');
process.exit(succes ? 0 : 1);
