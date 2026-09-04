/**
 * Port d'accès à l'annuaire (docs/AUTH.md).
 *
 * Deux opérations seulement, les seules dont Sentinel a besoin : vérifier un
 * couple identifiant/mot de passe, et chercher des personnes par fragment de
 * nom. Tout le reste — appartenance à des groupes, attributs métier — reste
 * hors du périmètre.
 *
 * L'interface permet de substituer un annuaire simulé en développement, où le
 * contrôleur de domaine n'est pas joignable, sans disperser de conditions sur
 * l'environnement dans le code métier (docs/CLAUDE.md §5.1).
 */

export interface DirectoryPerson {
  /** `sAMAccountName`, sans le domaine. */
  username: string;
  displayName: string;
  email: string | null;
}

export interface DirectoryAuthResult {
  authenticated: boolean;
  /**
   * `unreachable` distingue « mot de passe refusé » de « annuaire injoignable ».
   * Les confondre ferait afficher « identifiants incorrects » lors d'une panne
   * réseau, et enverrait tout le monde chercher au mauvais endroit.
   */
  reason?: 'invalid-credentials' | 'unreachable';
}

export interface Directory {
  readonly kind: 'ldap' | 'dev';

  /** L'annuaire répond-il ? Utilisé par la page de connexion pour situer une panne. */
  isReachable(): Promise<boolean>;

  /** Vérifie un couple identifiant / mot de passe. */
  authenticate(username: string, password: string): Promise<DirectoryAuthResult>;

  /** Recherche par fragment de nom ou d'identifiant. */
  search(needle: string, limit: number): Promise<DirectoryPerson[]>;

  /** Retrouve une personne par son identifiant exact. */
  findByUsername(username: string): Promise<DirectoryPerson | null>;
}

export const DIRECTORY = Symbol('DIRECTORY');
