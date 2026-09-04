import { randomInt } from 'node:crypto';

import { empreinteCode, normaliserCode } from './secret-box';

/**
 * Codes de récupération (docs/AUTH.md).
 *
 * Ils répondent à un cas parfaitement banal : le téléphone qui portait
 * l'application d'authentification est perdu, cassé ou réinitialisé. Sans eux,
 * la seule issue serait d'appeler un administrateur — et si la personne
 * concernée *est* le dernier administrateur, il n'y en aurait aucune.
 */

/** Dix codes : assez pour ne jamais en manquer, assez peu pour tenir sur un papier. */
export const NOMBRE_DE_CODES = 10;

/**
 * Alphabet sans caractères confondables : ni `0`/`O`, ni `1`/`I`/`L`.
 *
 * Ces codes sont faits pour être imprimés puis retapés, parfois des mois plus
 * tard. Une ambiguïté de lecture s'y paie par un refus incompréhensible.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const GROUPES = 2;
const PAR_GROUPE = 5;

/**
 * Un code, au format `XXXXX-XXXXX`.
 *
 * Dix caractères tirés dans un alphabet de 31 : environ 49 bits d'entropie.
 * Deviner un code demanderait des centaines de milliers de milliards d'essais,
 * là où la limitation de débit en autorise quelques-uns par minute.
 */
function genererUnCode(): string {
  return Array.from({ length: GROUPES }, () =>
    Array.from({ length: PAR_GROUPE }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  ).join('-');
}

export interface CodesGeneres {
  /** À afficher **une seule fois**, puis à oublier. */
  enClair: string[];
  /** À stocker. */
  empreintes: string[];
}

export function genererCodes(cle: Buffer): CodesGeneres {
  // Un tirage peut produire deux fois le même code : improbable, mais un
  // doublon consommerait deux entrées d'un coup et personne ne comprendrait
  // pourquoi il en reste huit après un seul usage.
  const codes = new Set<string>();
  while (codes.size < NOMBRE_DE_CODES) codes.add(genererUnCode());

  const enClair = [...codes];
  return { enClair, empreintes: enClair.map((code) => empreinteCode(code, cle)) };
}

/** Le code saisi ressemble-t-il à un code de récupération, plutôt qu'à un code TOTP ? */
export const ressembleAUnCodeDeRecuperation = (saisi: string): boolean =>
  normaliserCode(saisi).length === GROUPES * PAR_GROUPE && !/^\d+$/.test(normaliserCode(saisi));
