import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Mots de passe à usage unique fondés sur le temps — TOTP, RFC 6238 (docs/AUTH.md).
 *
 * Écrit ici plutôt qu'emprunté à une bibliothèque : l'algorithme tient en une
 * trentaine de lignes, et la RFC publie des **vecteurs de test** qui en
 * vérifient l'exactitude de bout en bout. Une implémentation qu'on peut prouver
 * juste vaut mieux qu'une dépendance de plus dans la chaîne d'approvisionnement
 * d'une application qui supervise une production monétique (docs/SECURITY.md
 * A08).
 */

/** Paramètres standard, ceux qu'attendent Google Authenticator, Authy et FreeOTP. */
export const TOTP = {
  digits: 6,
  /** Durée de validité d'un code, en secondes. */
  period: 30,
  algorithm: 'sha1',
  /**
   * Fenêtres acceptées de part et d'autre de l'instant courant.
   *
   * `1` tolère une horloge décalée d'une demi-minute — cas courant sur un
   * téléphone — au prix de trois codes valides simultanément au lieu d'un.
   * Au-delà, on allongerait inutilement la durée de vie d'un code intercepté.
   */
  window: 1,
} as const;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode en base32 (RFC 4648), sans remplissage : c'est la forme attendue dans une URI `otpauth://`. */
export function toBase32(donnees: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let sortie = '';

  for (const octet of donnees) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      sortie += BASE32_ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += BASE32_ALPHABET[(valeur << (5 - bits)) & 31];

  return sortie;
}

/** Décode une base32, en tolérant le remplissage, les espaces et les minuscules. */
export function fromBase32(texte: string): Buffer {
  const propre = texte.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let valeur = 0;
  const octets: number[] = [];

  for (const caractere of propre) {
    const index = BASE32_ALPHABET.indexOf(caractere);
    if (index === -1) throw new Error('Caractère invalide dans le secret base32');
    valeur = (valeur << 5) | index;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(octets);
}

/**
 * Secret partagé, 20 octets — la taille recommandée par la RFC 4226 pour
 * HMAC-SHA1, et celle qu'attendent les applications d'authentification.
 */
export function genererSecret(): string {
  return toBase32(randomBytes(20));
}

/**
 * Code correspondant à un compteur donné (HOTP, RFC 4226 §5.3).
 *
 * La « troncature dynamique » n'est pas une coquetterie : prendre bêtement les
 * quatre premiers octets du HMAC biaiserait la distribution des codes. Le
 * dernier quartet désigne l'offset de lecture, ce qui répartit uniformément.
 */
function codePourCompteur(secret: Buffer, compteur: number): string {
  const tampon = Buffer.alloc(8);
  // `writeBigUInt64BE` : le compteur dépasse 2^32 pour des dates lointaines, et
  // une écriture sur 32 bits le tronquerait silencieusement.
  tampon.writeBigUInt64BE(BigInt(compteur));

  const empreinte = createHmac(TOTP.algorithm, secret).update(tampon).digest();
  const offset = empreinte[empreinte.length - 1]! & 0x0f;
  const binaire =
    ((empreinte[offset]! & 0x7f) << 24) |
    ((empreinte[offset + 1]! & 0xff) << 16) |
    ((empreinte[offset + 2]! & 0xff) << 8) |
    (empreinte[offset + 3]! & 0xff);

  return (binaire % 10 ** TOTP.digits).toString().padStart(TOTP.digits, '0');
}

/** Code attendu à un instant donné (par défaut : maintenant). */
export function genererCode(secretBase32: string, instant: Date = new Date()): string {
  const compteur = Math.floor(instant.getTime() / 1000 / TOTP.period);
  return codePourCompteur(fromBase32(secretBase32), compteur);
}

/**
 * Vérifie un code saisi.
 *
 * La comparaison est faite en **temps constant** : une comparaison ordinaire
 * s'arrête au premier chiffre différent et laisserait fuir, par le temps de
 * réponse, la position de la divergence — de quoi retrouver un code chiffre par
 * chiffre au lieu d'avoir à en deviner un million.
 */
export function verifierCode(secretBase32: string, saisi: string, instant: Date = new Date()): boolean {
  const propre = saisi.replace(/\s/g, '');
  if (!/^\d+$/.test(propre) || propre.length !== TOTP.digits) return false;

  let secret: Buffer;
  try {
    secret = fromBase32(secretBase32);
  } catch {
    return false;
  }
  if (secret.length === 0) return false;

  const compteur = Math.floor(instant.getTime() / 1000 / TOTP.period);
  const attendu = Buffer.from(propre, 'utf8');

  let valide = false;
  for (let decalage = -TOTP.window; decalage <= TOTP.window; decalage += 1) {
    const candidat = Buffer.from(codePourCompteur(secret, compteur + decalage), 'utf8');
    // Pas de sortie anticipée : s'arrêter au premier succès rendrait le temps de
    // réponse dépendant de la fenêtre qui a correspondu.
    if (candidat.length === attendu.length && timingSafeEqual(candidat, attendu)) valide = true;
  }

  return valide;
}

/**
 * URI `otpauth://` à présenter en QR code.
 *
 * L'émetteur apparaît deux fois — dans le libellé et en paramètre — parce que
 * les applications d'authentification ne lisent pas toutes le même : sans les
 * deux, le compte s'affiche sans nom d'application dans certaines d'entre elles.
 */
export function construireUri(secretBase32: string, compte: string, emetteur = 'Sentinel'): string {
  const libelle = encodeURIComponent(`${emetteur}:${compte}`);
  const parametres = new URLSearchParams({
    secret: secretBase32,
    issuer: emetteur,
    algorithm: TOTP.algorithm.toUpperCase(),
    digits: String(TOTP.digits),
    period: String(TOTP.period),
  });
  return `otpauth://totp/${libelle}?${parametres.toString()}`;
}
