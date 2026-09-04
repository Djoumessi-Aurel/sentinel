import {
  buildPersonSearchFilter,
  buildUsernameFilter,
  escapeDnValue,
  escapeFilterValue,
} from './ldap-filter';

describe('échappement des filtres LDAP', () => {
  it('laisse intacte une saisie ordinaire', () => {
    expect(escapeFilterValue('adjoumessi')).toBe('adjoumessi');
    expect(escapeFilterValue('Aurel Djoumessi')).toBe('Aurel Djoumessi');
    expect(escapeFilterValue('a.b-c_d@gie.local')).toBe('a.b-c_d@gie.local');
  });

  it('échappe les caractères réservés', () => {
    expect(escapeFilterValue('*')).toBe('\\2a');
    expect(escapeFilterValue('(')).toBe('\\28');
    expect(escapeFilterValue(')')).toBe('\\29');
    expect(escapeFilterValue('\\')).toBe('\\5c');
    expect(escapeFilterValue('/')).toBe('\\2f');
    expect(escapeFilterValue('\0')).toBe('\\00');
  });

  it('échappe la barre oblique inverse avant tout le reste', () => {
    // Si `*` était traité en premier, son échappement `\2a` verrait ensuite sa
    // propre barre oblique inverse ré-échappée en `\5c2a` — le filtre
    // chercherait alors la chaîne littérale « \2a ».
    expect(escapeFilterValue('\\*')).toBe('\\5c\\2a');
  });

  it('neutralise une tentative d’injection', () => {
    // Sans échappement, ce fragment refermerait le filtre et ajouterait sa
    // propre clause, transformant la recherche en énumération de l'annuaire.
    const filtre = buildPersonSearchFilter('*)(objectClass=*');

    expect(filtre).not.toContain('*)(objectClass=*');
    expect(filtre).toContain('\\2a\\29\\28objectClass=\\2a');

    // La structure attendue reste intacte : les parenthèses du filtre lui-même
    // s'équilibrent toujours.
    const ouvrantes = (filtre.match(/(?<!\\2)\(/g) ?? []).length;
    expect(filtre.split('').filter((c) => c === '(').length).toBe(ouvrantes);
  });

  it('cherche sur l’identifiant, le nom affiché, le nom commun et l’adresse', () => {
    const filtre = buildPersonSearchFilter('kamga');
    expect(filtre).toContain('(sAMAccountName=*kamga*)');
    expect(filtre).toContain('(displayName=*kamga*)');
    expect(filtre).toContain('(cn=*kamga*)');
    expect(filtre).toContain('(mail=*kamga*)');
    expect(filtre).toContain('(objectCategory=person)');
  });

  it('identifie exactement, sans joker', () => {
    // Un joker ici ferait correspondre « jkamga » à « jkamga2 » : on
    // authentifierait quelqu'un d'autre.
    const filtre = buildUsernameFilter('jkamga');
    expect(filtre).toContain('(sAMAccountName=jkamga)');
    expect(filtre).not.toContain('*');
  });

  it('échappe aussi l’identifiant exact', () => {
    expect(buildUsernameFilter('j*kamga')).toContain('(sAMAccountName=j\\2akamga)');
  });

  it('échappe les valeurs de DN selon leurs propres règles', () => {
    expect(escapeDnValue('Dupont, Jean')).toBe('Dupont\\, Jean');
    expect(escapeDnValue('a+b')).toBe('a\\+b');
    expect(escapeDnValue(' bord')).toBe('\\ bord');
  });
});
