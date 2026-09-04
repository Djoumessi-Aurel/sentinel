import { construireUri, fromBase32, genererCode, genererSecret, toBase32, verifierCode } from './totp';

/**
 * Vecteurs de test de la RFC 6238, annexe B.
 *
 * Secret : la chaîne ASCII « 12345678901234567890 », 20 octets, HMAC-SHA1.
 * La RFC publie des codes à huit chiffres ; Sentinel en produit six, soit les
 * six derniers — la troncature porte sur le même entier.
 */
const SECRET_RFC = toBase32(Buffer.from('12345678901234567890', 'ascii'));

const VECTEURS: Array<{ secondes: number; huitChiffres: string }> = [
  { secondes: 59, huitChiffres: '94287082' },
  { secondes: 1_111_111_109, huitChiffres: '07081804' },
  { secondes: 1_111_111_111, huitChiffres: '14050471' },
  { secondes: 1_234_567_890, huitChiffres: '89005924' },
  { secondes: 2_000_000_000, huitChiffres: '69279037' },
  { secondes: 20_000_000_000, huitChiffres: '65353130' },
];

describe('TOTP (RFC 6238)', () => {
  it.each(VECTEURS)('produit le code attendu à T=$secondes', ({ secondes, huitChiffres }) => {
    const attendu = huitChiffres.slice(-6);
    expect(genererCode(SECRET_RFC, new Date(secondes * 1000))).toBe(attendu);
  });

  it('accepte le code de l’instant courant', () => {
    const secret = genererSecret();
    expect(verifierCode(secret, genererCode(secret))).toBe(true);
  });

  it('tolère une horloge décalée d’une période', () => {
    const secret = genererSecret();
    const maintenant = new Date();
    const avant = new Date(maintenant.getTime() - 30_000);
    const apres = new Date(maintenant.getTime() + 30_000);

    expect(verifierCode(secret, genererCode(secret, avant), maintenant)).toBe(true);
    expect(verifierCode(secret, genererCode(secret, apres), maintenant)).toBe(true);
  });

  it('refuse un code trop ancien', () => {
    // Deux périodes en arrière : hors fenêtre. Sans cette limite, un code
    // intercepté resterait utilisable bien après sa péremption.
    const secret = genererSecret();
    const maintenant = new Date();
    const trop = new Date(maintenant.getTime() - 90_000);
    expect(verifierCode(secret, genererCode(secret, trop), maintenant)).toBe(false);
  });

  it('refuse une saisie qui n’est pas six chiffres', () => {
    const secret = genererSecret();
    for (const saisie of ['', '12345', '1234567', 'abcdef', '12 34 56 78', '-12345']) {
      expect(verifierCode(secret, saisie)).toBe(false);
    }
  });

  it('tolère les espaces de saisie', () => {
    const secret = genererSecret();
    const code = genererCode(secret);
    expect(verifierCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
  });

  it('refuse sans lever d’exception si le secret est illisible', () => {
    expect(verifierCode('pas un secret base32 !', '123456')).toBe(false);
    expect(verifierCode('', '123456')).toBe(false);
  });

  it('ne valide pas le code d’un autre secret', () => {
    const a = genererSecret();
    const b = genererSecret();
    expect(verifierCode(a, genererCode(b))).toBe(false);
  });
});

describe('base32', () => {
  it('fait l’aller-retour', () => {
    for (const taille of [1, 2, 3, 4, 5, 10, 20, 32]) {
      const donnees = Buffer.from(Array.from({ length: taille }, (_, i) => (i * 37) % 256));
      expect(fromBase32(toBase32(donnees)).equals(donnees)).toBe(true);
    }
  });

  it('encode conformément à la RFC 4648', () => {
    expect(toBase32(Buffer.from('foobar', 'ascii'))).toBe('MZXW6YTBOI');
    expect(toBase32(Buffer.from('f', 'ascii'))).toBe('MY');
  });

  it('n’émet aucun remplissage', () => {
    // Les applications d'authentification acceptent le `=`, mais plusieurs
    // lecteurs de QR le recopient tel quel dans le champ de saisie manuelle,
    // où il est ensuite refusé.
    expect(toBase32(Buffer.from('f', 'ascii'))).not.toContain('=');
  });

  it('tolère minuscules, espaces et remplissage au décodage', () => {
    expect(fromBase32('mzxw 6ytb oi==').toString('ascii')).toBe('foobar');
  });

  it('produit un secret de 32 caractères, soit 20 octets', () => {
    const secret = genererSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(fromBase32(secret)).toHaveLength(20);
  });
});

describe('URI otpauth', () => {
  it('porte tous les paramètres attendus', () => {
    const uri = construireUri('JBSWY3DPEHPK3PXP', 'jdupont');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Sentinel%3Ajdupont\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Sentinel');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('échappe un identifiant contenant des caractères réservés', () => {
    const uri = construireUri('JBSWY3DPEHPK3PXP', 'jean dupont@gie.local');
    expect(uri).not.toContain(' ');
    expect(uri).toContain('%40');
  });
});
