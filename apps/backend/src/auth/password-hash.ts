import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// Surcharge explicite : `promisify` retiendrait sinon la variante sans options,
// et les paramètres de coût seraient silencieusement ignorés.
const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);

/**
 * Hachage des mots de passe des deux comptes techniques (docs/AUTH.md).
 *
 * **Un hachage, pas un chiffrement.** On n'a jamais besoin de retrouver le mot
 * de passe, seulement de vérifier celui qui est saisi : un chiffré supposerait
 * une clé capable de le déchiffrer, donc un secret de plus à protéger et une
 * valeur récupérable en clair par qui met la main dessus. Le hachage rend
 * l'opération à sens unique.
 *
 * `scrypt` plutôt que SHA : c'est une fonction de dérivation *lente et
 * gourmande en mémoire*, conçue pour rendre une attaque par dictionnaire
 * coûteuse (docs/SECURITY.md A02). Elle est fournie par Node, sans dépendance
 * supplémentaire.
 */

/**
 * Paramètres de coût. `N = 2^15` demande environ 32 Mio et quelques dizaines de
 * millisecondes — négligeable pour une connexion, très pénalisant à grande
 * échelle pour un attaquant.
 */
const COST = { N: 32_768, r: 8, p: 1, keyLength: 64 } as const;

const SEPARATOR = '$';
const PREFIX = 'scrypt';

/** Produit une empreinte autoportante : `scrypt$N$r$p$sel$empreinte`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, COST.keyLength, {
    N: COST.N,
    r: COST.r,
    p: COST.p,
    // Sans cela, Node refuse les paramètres au-delà de 32 Mio de mémoire.
    maxmem: 256 * 1024 * 1024,
  });

  return [PREFIX, COST.N, COST.r, COST.p, salt.toString('base64'), derived.toString('base64')].join(SEPARATOR);
}

/**
 * Vérifie un mot de passe contre une empreinte.
 *
 * La comparaison finale est faite en **temps constant** : une comparaison
 * ordinaire s'arrête au premier octet différent, ce qui laisse fuir, par le
 * temps de réponse, la position de la divergence.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(SEPARATOR);
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts as [string, string, string, string, string, string];
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = Buffer.from(rawHash, 'base64');
    salt = Buffer.from(rawSalt, 'base64');
  } catch {
    return false;
  }
  if (expected.length === 0 || salt.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    // Paramètres aberrants dans l'empreinte stockée : on refuse, on ne devine pas.
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Une valeur ressemble-t-elle à une empreinte produite ici ? */
export const looksLikeHash = (value: string): boolean =>
  value.startsWith(`${PREFIX}${SEPARATOR}`) && value.split(SEPARATOR).length === 6;
