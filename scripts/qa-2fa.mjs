// Vérifie la double authentification de bout en bout : appairage, connexion en
// deux étapes, codes de récupération, réglage global et session restreinte.
//
// Se lance contre un backend démarré : `npm run qa:2fa`.
import { createRequire } from 'node:module';

const API = 'http://localhost:3001/api';
const PERSONNE = 'ctchoua';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { genererCode } = require('../apps/backend/dist/auth/totp.js');
const prisma = new PrismaClient();

let cookieCourant = null;

const appel = async (methode, chemin, corps) => {
  const reponse = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieCourant ? { Cookie: cookieCourant } : {}),
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
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
  return { statut: reponse.status, donnees };
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/** La limite est de cinq connexions par minute : on patiente au lieu d'échouer. */
const connexion = async (username, password) => {
  for (let essai = 0; essai < 3; essai += 1) {
    const r = await appel('POST', '/auth/login', { username, password });
    if (r.statut !== 429) return r;
    console.log('        (limite de tentatives atteinte, attente de la fenêtre…)');
    await attendre(62_000);
  }
  return { statut: 429, donnees: null };
};

const resultats = [];
const verifier = (libelle, condition, detail = '') => {
  resultats.push(condition);
  console.log(`  ${condition ? 'OK   ' : 'ECHEC'} ${libelle}${detail ? ` — ${detail}` : ''}`);
};

/** État de départ : la personne de test existe, sans double authentification. */
const remiseAZero = async () => {
  await prisma.authSettings.upsert({
    where: { id: 'singleton' },
    update: { twoFactorEnforced: false },
    create: { id: 'singleton', twoFactorEnforced: false },
  });
  const user = await prisma.user.findUnique({ where: { username: PERSONNE } });
  if (user) {
    await prisma.recoveryCode.deleteMany({ where: { userId: user.id } });
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorConfirmedAt: null, enabled: true },
    });
  }
};

await remiseAZero();

const utilisateurDeTest = await prisma.user.findUnique({ where: { username: PERSONNE } });
if (!utilisateurDeTest) {
  console.error(`L'utilisateur de test « ${PERSONNE} » n'est pas déclaré. Ajoutez-le avant de relancer.`);
  await prisma.$disconnect();
  process.exit(2);
}

console.log('--- Appairage ---');
let r = await connexion(PERSONNE, 'peu importe en mode dev');
verifier('connexion sans second facteur', r.statut === 200 && !r.donnees?.requiresTwoFactor);

r = await appel('GET', '/auth/2fa/status');
verifier('la double authentification est inactive au départ', r.statut === 200 && r.donnees?.enabled === false, JSON.stringify(r.donnees));

r = await appel('POST', '/auth/2fa/setup');
const appairage = r.donnees;
verifier('un secret et un QR code sont proposés', r.statut === 200 && typeof appairage?.secret === 'string');
verifier('le secret est en base32 sur 32 caractères', /^[A-Z2-7]{32}$/.test(appairage?.secret ?? ''), appairage?.secret);
verifier("l'URI otpauth est complète", (appairage?.otpauthUri ?? '').startsWith('otpauth://totp/Sentinel%3A'), appairage?.otpauthUri?.slice(0, 60));
verifier('le QR code est une image SVG en data URI', (appairage?.qrCode ?? '').startsWith('data:image/svg+xml;base64,'));

r = await appel('POST', '/auth/2fa/confirm', { code: '000000' });
verifier('un code incorrect ne confirme rien', r.statut === 400, r.donnees?.message);

r = await appel('GET', '/auth/2fa/status');
verifier('et laisse la double authentification inactive', r.donnees?.enabled === false);

r = await appel('POST', '/auth/2fa/confirm', { code: genererCode(appairage.secret) });
const codesDeRecuperation = r.donnees?.codes ?? [];
verifier('le bon code confirme l’appairage', r.statut === 200 && codesDeRecuperation.length === 10, `${codesDeRecuperation.length} code(s)`);
verifier('les codes de récupération sont au bon format', codesDeRecuperation.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)), codesDeRecuperation[0]);

r = await appel('GET', '/auth/2fa/status');
verifier('la double authentification est maintenant active', r.donnees?.enabled === true && r.donnees?.recoveryCodesRemaining === 10, JSON.stringify(r.donnees));

console.log('');
console.log('--- Connexion en deux étapes ---');
cookieCourant = null;
r = await connexion(PERSONNE, 'peu importe en mode dev');
const defi = r.donnees?.challengeToken;
verifier('le mot de passe seul ne suffit plus', r.statut === 200 && r.donnees?.requiresTwoFactor === true);
verifier('un jeton de défi est délivré', typeof defi === 'string' && defi.length > 20);
verifier('aucune session n’est ouverte à cette étape', (await appel('GET', '/applications')).statut === 401);

r = await appel('POST', '/auth/2fa/challenge', { challengeToken: defi, code: '000000' });
verifier('un mauvais code est refusé', r.statut === 401, r.donnees?.message);

r = await appel('POST', '/auth/2fa/challenge', { challengeToken: defi, code: genererCode(appairage.secret) });
verifier('le bon code ouvre la session', r.statut === 200 && r.donnees?.username === PERSONNE, JSON.stringify(r.donnees));
verifier('la session fonctionne', (await appel('GET', '/applications')).statut === 200);

r = await appel('POST', '/auth/2fa/challenge', { challengeToken: 'jeton-invente', code: genererCode(appairage.secret) });
verifier('un jeton de défi forgé est refusé', r.statut === 401, r.donnees?.message);

console.log('');
console.log('--- Codes de récupération ---');
cookieCourant = null;
r = await connexion(PERSONNE, 'peu importe en mode dev');
const defi2 = r.donnees?.challengeToken;
const codeDeSecours = codesDeRecuperation[0];

r = await appel('POST', '/auth/2fa/challenge', { challengeToken: defi2, code: codeDeSecours });
verifier('un code de récupération ouvre la session', r.statut === 200 && r.donnees?.username === PERSONNE);

r = await appel('GET', '/auth/2fa/status');
verifier('il en reste neuf', r.donnees?.recoveryCodesRemaining === 9, `${r.donnees?.recoveryCodesRemaining}`);

cookieCourant = null;
r = await connexion(PERSONNE, 'peu importe en mode dev');
r = await appel('POST', '/auth/2fa/challenge', { challengeToken: r.donnees?.challengeToken, code: codeDeSecours });
verifier('un code déjà utilisé ne fonctionne plus', r.statut === 401, r.donnees?.message);

console.log('');
console.log('--- Réglage global : la 2FA imposée ---');
cookieCourant = null;
r = await connexion('sentineladmin', 'sentinel-admin-dev-2026');
verifier('un compte technique n’a jamais de second facteur', r.statut === 200 && r.donnees?.username === 'sentineladmin');

r = await appel('PATCH', '/auth/settings', { twoFactorEnforced: true });
verifier('un administrateur peut imposer la double authentification', r.statut === 200 && r.donnees?.twoFactorEnforced === true);

// Une personne déclarée qui n'a pas encore appairé : session restreinte.
const AUTRE = 'jkamga';
const autre = await prisma.user.findUnique({ where: { username: AUTRE } });
if (autre) {
  cookieCourant = null;
  r = await connexion(AUTRE, 'peu importe en mode dev');
  verifier('sans appairage, la session s’ouvre en mode restreint', r.statut === 200 && r.donnees?.mustEnrollTwoFactor === true, JSON.stringify(r.donnees));
  verifier('elle ne donne accès à rien d’autre', (await appel('GET', '/applications')).statut === 403);
  verifier('sauf à l’appairage', (await appel('GET', '/auth/2fa/status')).statut === 200);
} else {
  console.log(`  (ignoré : « ${AUTRE} » n'est pas déclaré)`);
}

cookieCourant = null;
r = await connexion(PERSONNE, 'peu importe en mode dev');
r = await appel('POST', '/auth/2fa/challenge', { challengeToken: r.donnees?.challengeToken, code: genererCode(appairage.secret) });
verifier('un compte appairé se connecte normalement', r.statut === 200);

r = await appel('POST', '/auth/2fa/disable');
verifier('on ne peut pas la désactiver tant qu’elle est imposée', r.statut === 400, r.donnees?.message);

console.log('');
console.log('--- Retour au choix libre ---');
cookieCourant = null;
r = await connexion('sentineladmin', 'sentinel-admin-dev-2026');
r = await appel('PATCH', '/auth/settings', { twoFactorEnforced: false });
verifier('l’administrateur lève l’obligation', r.statut === 200 && r.donnees?.twoFactorEnforced === false);

r = await appel('PATCH', `/users/${utilisateurDeTest.id}`, { twoFactorEnabled: false });
verifier('un administrateur peut réinitialiser la 2FA de quelqu’un', r.statut === 200 && r.donnees?.twoFactorEnabled === false, JSON.stringify(r.donnees?.twoFactorEnabled));

cookieCourant = null;
r = await connexion(PERSONNE, 'peu importe en mode dev');
verifier('la personne se reconnecte alors sans second facteur', r.statut === 200 && !r.donnees?.requiresTwoFactor);

await remiseAZero();
await prisma.$disconnect();

const succes = resultats.every(Boolean);
console.log('');
console.log(`${resultats.filter(Boolean).length}/${resultats.length} vérifications passées`);
console.log(succes ? 'RESULTAT : double authentification FONCTIONNELLE' : 'RESULTAT : ECHEC');
process.exit(succes ? 0 : 1);
