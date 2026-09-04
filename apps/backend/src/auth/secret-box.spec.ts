import { randomBytes } from 'node:crypto';

import { genererCodes, NOMBRE_DE_CODES, ressembleAUnCodeDeRecuperation } from './recovery-codes';
import { chiffrer, dechiffrer, derriverCles, empreinteCode, memeEmpreinte, normaliserCode } from './secret-box';

const CLE_MAITRE = randomBytes(32).toString('hex');

describe('dérivation des clés', () => {
  it('accepte l’hexadécimal et la base64', () => {
    const brut = randomBytes(32);
    const parHex = derriverCles(brut.toString('hex'));
    const parBase64 = derriverCles(brut.toString('base64'));
    expect(parHex.chiffrement.equals(parBase64.chiffrement)).toBe(true);
  });

  it('produit deux clés différentes', () => {
    // Une même clé pour chiffrer et pour signer ferait qu'un défaut sur l'un des
    // deux usages fragiliserait l'autre.
    const { chiffrement, empreinte } = derriverCles(CLE_MAITRE);
    expect(chiffrement.equals(empreinte)).toBe(false);
    expect(chiffrement).toHaveLength(32);
  });

  it('est déterministe', () => {
    expect(derriverCles(CLE_MAITRE).chiffrement.equals(derriverCles(CLE_MAITRE).chiffrement)).toBe(true);
  });

  it('refuse une clé trop courte, en disant comment en produire une', () => {
    expect(() => derriverCles('trop-court')).toThrow(/32 octets/);
    expect(() => derriverCles(randomBytes(16).toString('hex'))).toThrow(/AUTH_ENCRYPTION_KEY/);
  });
});

describe('chiffrement des secrets', () => {
  const { chiffrement } = derriverCles(CLE_MAITRE);
  const CONTEXTE = 'totp:utilisateur-1';

  it('fait l’aller-retour', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    expect(dechiffrer(chiffrer(secret, chiffrement, CONTEXTE), chiffrement, CONTEXTE)).toBe(secret);
  });

  it('produit un chiffré différent à chaque fois', () => {
    // Deux chiffrés identiques pour une même valeur révéleraient que deux
    // utilisateurs partagent le même secret.
    const a = chiffrer('secret', chiffrement, CONTEXTE);
    const b = chiffrer('secret', chiffrement, CONTEXTE);
    expect(a).not.toEqual(b);
    expect(dechiffrer(a, chiffrement, CONTEXTE)).toBe('secret');
    expect(dechiffrer(b, chiffrement, CONTEXTE)).toBe('secret');
  });

  it('ne laisse pas la valeur apparaître dans le chiffré', () => {
    expect(chiffrer('VALEUR-RECONNAISSABLE', chiffrement, CONTEXTE)).not.toContain('VALEUR');
  });

  it('refuse un chiffré destiné à un autre contexte', () => {
    // Sans cette liaison, le secret d'un utilisateur recopié sur la ligne d'un
    // autre se déchiffrerait sans rien signaler.
    const chiffre = chiffrer('secret', chiffrement, 'totp:utilisateur-1');
    expect(dechiffrer(chiffre, chiffrement, 'totp:utilisateur-2')).toBeNull();
  });

  it('refuse un chiffré altéré', () => {
    const chiffre = chiffrer('secret', chiffrement, CONTEXTE);
    const parties = chiffre.split('$');
    const altere = [parties[0], parties[1], parties[2], Buffer.from('autre chose').toString('base64')].join('$');
    expect(dechiffrer(altere, chiffrement, CONTEXTE)).toBeNull();
  });

  it('refuse un chiffré produit avec une autre clé', () => {
    const autre = derriverCles(randomBytes(32).toString('hex')).chiffrement;
    expect(dechiffrer(chiffrer('secret', autre, CONTEXTE), chiffrement, CONTEXTE)).toBeNull();
  });

  it('refuse une valeur malformée sans lever', () => {
    for (const valeur of ['', 'pas-un-chiffre', 'v1$a$b', 'v2$a$b$c', '$$$']) {
      expect(dechiffrer(valeur, chiffrement, CONTEXTE)).toBeNull();
    }
  });
});

describe('codes de récupération', () => {
  const { empreinte } = derriverCles(CLE_MAITRE);

  it('en produit dix, tous différents', () => {
    const { enClair, empreintes } = genererCodes(empreinte);
    expect(enClair).toHaveLength(NOMBRE_DE_CODES);
    expect(new Set(enClair).size).toBe(NOMBRE_DE_CODES);
    expect(new Set(empreintes).size).toBe(NOMBRE_DE_CODES);
  });

  it('les met au format XXXXX-XXXXX, sans caractère confondable', () => {
    for (const code of genererCodes(empreinte).enClair) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('reconnaît le code quelle que soit la façon de le saisir', () => {
    const [code] = genererCodes(empreinte).enClair;
    const attendu = empreinteCode(code!, empreinte);

    for (const variante of [code!, code!.toLowerCase(), code!.replace('-', ''), ` ${code!} `]) {
      expect(memeEmpreinte(empreinteCode(variante, empreinte), attendu)).toBe(true);
    }
  });

  it('ne stocke jamais le code en clair', () => {
    const { enClair, empreintes } = genererCodes(empreinte);
    for (const [index, code] of enClair.entries()) {
      expect(empreintes[index]).not.toContain(normaliserCode(code));
    }
  });

  it('distingue un code de récupération d’un code TOTP', () => {
    expect(ressembleAUnCodeDeRecuperation('ABCDE-FGHJK')).toBe(true);
    expect(ressembleAUnCodeDeRecuperation('abcde fghjk')).toBe(true);
    expect(ressembleAUnCodeDeRecuperation('123456')).toBe(false);
    expect(ressembleAUnCodeDeRecuperation('')).toBe(false);
  });

  it('exige la clé pour retrouver l’empreinte', () => {
    // Une base volée sans le fichier de configuration ne permet pas de tester
    // les codes hors ligne.
    const autre = derriverCles(randomBytes(32).toString('hex')).empreinte;
    const [code] = genererCodes(empreinte).enClair;
    expect(empreinteCode(code!, autre)).not.toBe(empreinteCode(code!, empreinte));
  });
});
