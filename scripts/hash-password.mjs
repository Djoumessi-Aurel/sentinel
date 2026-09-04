#!/usr/bin/env node
/**
 * Génère l'empreinte d'un mot de passe pour les comptes techniques
 * `sentineluser` et `sentineladmin` (docs/AUTH.md).
 *
 *   npm run auth:hash-password
 *
 * Le mot de passe est demandé **sans écho** et n'est jamais écrit sur disque,
 * ni passé en argument de ligne de commande : un argument se retrouve dans
 * l'historique du shell et dans la liste des processus, visible par les autres
 * utilisateurs de la machine.
 */
import { randomBytes, scrypt } from 'node:crypto';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const COST = { N: 32_768, r: 8, p: 1, keyLength: 64 };

/** Saisie masquée : le mot de passe ne doit pas rester lisible à l'écran. */
function demanderMotDePasse(question) {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const sortie = process.stdout;

    // On neutralise l'écho en interceptant l'écriture faite par readline.
    const ecrireOriginal = sortie.write.bind(sortie);
    let masquer = false;
    sortie.write = (chunk, ...reste) => (masquer ? true : ecrireOriginal(chunk, ...reste));

    ecrireOriginal(question);
    masquer = true;

    rl.question('', (reponse) => {
      masquer = false;
      sortie.write = ecrireOriginal;
      ecrireOriginal('\n');
      rl.close();
      resolve(reponse);
    });
    rl.on('error', reject);
  });
}

const motDePasse = await demanderMotDePasse('Mot de passe : ');
const confirmation = await demanderMotDePasse('Confirmation : ');

if (motDePasse.length === 0) {
  console.error('Mot de passe vide : abandon.');
  process.exit(1);
}
if (motDePasse !== confirmation) {
  console.error('Les deux saisies diffèrent : abandon.');
  process.exit(1);
}
if (motDePasse.length < 12) {
  console.error(
    `Mot de passe de ${motDePasse.length} caractères : trop court. ` +
      "Ces comptes ne sont pas protégés par l'Active Directory et n'ont aucun verrouillage après échecs : " +
      'viser 16 caractères ou plus.',
  );
  process.exit(1);
}

const salt = randomBytes(16);
const derived = await scryptAsync(motDePasse.normalize('NFKC'), salt, COST.keyLength, {
  N: COST.N,
  r: COST.r,
  p: COST.p,
  maxmem: 256 * 1024 * 1024,
});

const empreinte = ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), derived.toString('base64')].join('$');

console.log('');
console.log('Empreinte à reporter dans le .env :');
console.log('');
console.log(`  SENTINEL_USER_PASSWORD_HASH='${empreinte}'`);
console.log('');
console.log('  (ou SENTINEL_ADMIN_PASSWORD_HASH selon le compte concerné)');
console.log('');
console.log("Les apostrophes sont nécessaires : l'empreinte contient des caractères $.");
