/**
 * Échappement des valeurs insérées dans un filtre LDAP (RFC 4515).
 *
 * Point de sécurité réel, et facile à manquer : construire un filtre par
 * concaténation — `(cn=*${saisie}*)` — laisse la saisie modifier la **structure**
 * du filtre. Un `*` transforme une recherche ciblée en énumération complète de
 * l'annuaire ; une parenthèse permet d'ajouter une clause. C'est l'équivalent
 * LDAP d'une injection SQL (docs/SECURITY.md A03).
 *
 * Les caractères réservés sont donc remplacés par leur échappement hexadécimal.
 */

const ESCAPES: Record<string, string> = {
  '\\': '\\5c',
  '*': '\\2a',
  '(': '\\28',
  ')': '\\29',
  '\0': '\\00',
  '/': '\\2f',
};

/** Échappe une valeur destinée à un filtre LDAP. */
export function escapeFilterValue(value: string): string {
  let sortie = '';
  for (const caractere of value) {
    sortie += ESCAPES[caractere] ?? caractere;
  }
  return sortie;
}

/** Échappe une valeur destinée à un DN (RFC 4514), pour les cas où l'on en compose un. */
export function escapeDnValue(value: string): string {
  return value.replace(/([\\,+"<>;=])/g, '\\$1').replace(/^ | $/g, '\\ ');
}

/**
 * Filtre de recherche de personnes.
 *
 * Le fragment est comparé à l'identifiant de connexion, au nom affiché et au nom
 * commun : un administrateur cherche indifféremment « adjoumessi », « Aurel » ou
 * « Djoumessi », et doit trouver dans les trois cas.
 */
export function buildPersonSearchFilter(needle: string): string {
  const valeur = escapeFilterValue(needle);
  return (
    '(&(objectCategory=person)(objectClass=user)' +
    `(|(sAMAccountName=*${valeur}*)(displayName=*${valeur}*)(cn=*${valeur}*)(mail=*${valeur}*)))`
  );
}

/** Filtre d'identification exacte par `sAMAccountName`. */
export function buildUsernameFilter(username: string): string {
  return `(&(objectCategory=person)(objectClass=user)(sAMAccountName=${escapeFilterValue(username)}))`;
}
