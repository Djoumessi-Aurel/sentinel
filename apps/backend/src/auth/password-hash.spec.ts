import { hashPassword, looksLikeHash, verifyPassword } from './password-hash';

// `scrypt` est volontairement lent : chaque hachage coûte quelques dizaines de
// millisecondes, et un test qui en enchaîne plusieurs dépasse le défaut de 5 s.
jest.setTimeout(30_000);

describe('hachage des mots de passe', () => {
  it('accepte le bon mot de passe', async () => {
    const empreinte = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', empreinte)).resolves.toBe(true);
  });

  it('refuse un mot de passe voisin', async () => {
    const empreinte = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery stapl', empreinte)).resolves.toBe(false);
    await expect(verifyPassword('Correct horse battery staple', empreinte)).resolves.toBe(false);
    await expect(verifyPassword('', empreinte)).resolves.toBe(false);
  });

  it('produit une empreinte différente à chaque fois', async () => {
    // Deux empreintes identiques pour un même mot de passe trahiraient un sel
    // absent ou constant : une table précalculée les casserait toutes d'un coup.
    const [a, b] = await Promise.all([hashPassword('même mot de passe'), hashPassword('même mot de passe')]);
    expect(a).not.toEqual(b);
    await expect(verifyPassword('même mot de passe', a)).resolves.toBe(true);
    await expect(verifyPassword('même mot de passe', b)).resolves.toBe(true);
  });

  it('ne laisse jamais le mot de passe apparaître dans l’empreinte', async () => {
    const empreinte = await hashPassword('SecretTrèsReconnaissable42');
    expect(empreinte).not.toContain('SecretTrèsReconnaissable42');
  });

  it('normalise les formes Unicode équivalentes', async () => {
    // « é » composé et « é » décomposé se saisissent différemment selon le
    // clavier et le système, mais désignent le même caractère : refuser l'un
    // rendrait la connexion impossible depuis certains postes.
    const empreinte = await hashPassword('café-du-commerce');
    await expect(verifyPassword('café-du-commerce', empreinte)).resolves.toBe(true);
  });

  it('refuse une empreinte malformée sans lever d’exception', async () => {
    for (const valeur of [
      '',
      'pas-une-empreinte',
      'scrypt$32768$8$1$sel',
      'bcrypt$32768$8$1$c2Vs$aGFzaA==',
      'scrypt$abc$8$1$c2Vs$aGFzaA==',
      'scrypt$32768$8$1$$',
    ]) {
      await expect(verifyPassword('peu importe', valeur)).resolves.toBe(false);
    }
  });

  it('reconnaît la forme d’une empreinte', async () => {
    expect(looksLikeHash(await hashPassword('x'))).toBe(true);
    expect(looksLikeHash('mot-de-passe-en-clair')).toBe(false);
    expect(looksLikeHash('')).toBe(false);
  });
});
