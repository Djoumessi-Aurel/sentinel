import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Protection des secrets de double authentification (docs/AUTH.md).
 *
 * Deux besoins, deux traitements, et il ne faut pas les confondre :
 *
 * - Le **secret TOTP** doit être *relisible* : le serveur en dérive le code
 *   attendu à chaque vérification. On le **chiffre** donc, on ne le hache pas.
 * - Un **code de récupération** n'a jamais besoin d'être relu, seulement
 *   comparé. On en stocke une **empreinte**.
 *
 * C'est l'inverse du raisonnement tenu pour les mots de passe des comptes
 * techniques, qui sont hachés parce qu'on n'a jamais à les relire.
 */

/** Séparateur et version, pour pouvoir changer d'algorithme sans casser l'existant. */
const VERSION = 'v1';
const SEPARATEUR = '$';
const ALGORITHME = 'aes-256-gcm';
const TAILLE_IV = 12; // 96 bits, la taille recommandée pour GCM.

/**
 * Deux clés dérivées d'une seule, par HKDF.
 *
 * Réutiliser la même clé pour chiffrer et pour signer est une faute classique :
 * les deux usages n'ont pas les mêmes propriétés, et un défaut sur l'un
 * fragiliserait l'autre. La dérivation coûte quelques microsecondes au
 * démarrage et supprime la question.
 */
export interface ClesSecrets {
  chiffrement: Buffer;
  empreinte: Buffer;
}

/**
 * Lit `AUTH_ENCRYPTION_KEY`, en hexadécimal ou en base64, et en dérive les deux
 * clés. Refuse une clé trop courte : 32 octets, pas moins.
 */
export function derriverCles(cleMaitre: string): ClesSecrets {
  const brut = /^[0-9a-fA-F]{64}$/.test(cleMaitre.trim())
    ? Buffer.from(cleMaitre.trim(), 'hex')
    : Buffer.from(cleMaitre.trim(), 'base64');

  if (brut.length < 32) {
    throw new Error(
      "AUTH_ENCRYPTION_KEY doit faire au moins 32 octets (64 caractères hexadécimaux, ou 44 en base64). " +
        'Générer : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  return {
    chiffrement: Buffer.from(hkdfSync('sha256', brut, 'sentinel-2fa', 'chiffrement', 32)),
    empreinte: Buffer.from(hkdfSync('sha256', brut, 'sentinel-2fa', 'empreinte', 32)),
  };
}

/**
 * Chiffre une valeur. Produit `v1$iv$tag$chiffré`, tout en base64.
 *
 * `contexte` est authentifié sans être chiffré : il lie le chiffré à son usage.
 * Sans lui, un chiffré recopié d'un champ vers un autre — ou d'un utilisateur
 * vers un autre — se déchiffrerait sans broncher.
 */
export function chiffrer(valeur: string, cle: Buffer, contexte: string): string {
  const iv = randomBytes(TAILLE_IV);
  const chiffreur = createCipheriv(ALGORITHME, cle, iv);
  chiffreur.setAAD(Buffer.from(contexte, 'utf8'));

  const chiffre = Buffer.concat([chiffreur.update(valeur, 'utf8'), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), chiffre.toString('base64')].join(SEPARATEUR);
}

/**
 * Déchiffre. Renvoie `null` plutôt que de lever : un chiffré altéré, tronqué ou
 * produit avec une autre clé est un cas prévu — pas une exception à faire
 * remonter jusqu'à l'utilisateur.
 */
export function dechiffrer(stocke: string, cle: Buffer, contexte: string): string | null {
  const parties = stocke.split(SEPARATEUR);
  if (parties.length !== 4 || parties[0] !== VERSION) return null;

  try {
    const [, ivB64, tagB64, chiffreB64] = parties as [string, string, string, string];
    const dechiffreur = createDecipheriv(ALGORITHME, cle, Buffer.from(ivB64, 'base64'));
    dechiffreur.setAAD(Buffer.from(contexte, 'utf8'));
    dechiffreur.setAuthTag(Buffer.from(tagB64, 'base64'));

    return Buffer.concat([dechiffreur.update(Buffer.from(chiffreB64, 'base64')), dechiffreur.final()]).toString(
      'utf8',
    );
  } catch {
    // `final()` lève si le tag d'authentification ne correspond pas : c'est
    // précisément le signal qu'on attend d'une valeur altérée.
    return null;
  }
}

/**
 * Empreinte d'un code de récupération.
 *
 * HMAC plutôt que hachage nu : sans clé, une base volée permettrait de tester
 * les codes hors ligne, à la vitesse du matériel. Avec, il faut aussi le
 * fichier de configuration du serveur.
 *
 * SHA-256 suffit ici, là où les mots de passe demandent `scrypt` : ces codes
 * sont **tirés au sort** et portent une cinquantaine de bits d'entropie. Le
 * ralentissement délibéré de `scrypt` protège des secrets devinables ; il n'a
 * rien à protéger ici, et coûterait une seconde par tentative de connexion.
 */
export function empreinteCode(code: string, cle: Buffer): string {
  return createHmac('sha256', cle).update(normaliserCode(code)).digest('hex');
}

/** Comparaison en temps constant de deux empreintes hexadécimales. */
export function memeEmpreinte(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Forme canonique d'un code saisi : majuscules, sans espaces ni tirets.
 *
 * Les codes sont affichés en `XXXX-XXXX` pour être recopiables ; les gens les
 * saisissent avec ou sans tiret, en majuscules ou non. Refuser sur cette base
 * serait incompréhensible pour quelqu'un qui a le bon code sous les yeux.
 */
export function normaliserCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}
