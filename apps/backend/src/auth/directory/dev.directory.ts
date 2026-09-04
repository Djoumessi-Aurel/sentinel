import { Logger } from '@nestjs/common';

import type { Directory, DirectoryAuthResult, DirectoryPerson } from './directory.interface';

/**
 * Annuaire simulé, pour le développement (docs/AUTH.md, docs/DECISIONS.md D008).
 *
 * Le contrôleur de domaine n'est pas joignable depuis un poste de développement.
 * Cet adaptateur **n'effectue donc aucune vérification de mot de passe** : seule
 * la première étape s'applique — la personne fait-elle partie des utilisateurs
 * déclarés, et son compte est-il actif.
 *
 * C'est un contournement délibéré de l'authentification, et il ne doit jamais
 * atteindre la production : la validation de la configuration refuse `AUTH_MODE=dev`
 * lorsque `NODE_ENV=production`, et un avertissement est journalisé à chaque
 * démarrage puis à chaque connexion.
 */

/** Quelques personnes fictives, pour éprouver la recherche et l'ajout d'utilisateurs. */
const ANNUAIRE_SIMULE: DirectoryPerson[] = [
  { username: 'adjoumessi', displayName: 'Aurel Djoumessi', email: 'adjoumessi@gie.local' },
  { username: 'mxp', displayName: 'Monétique Exploitation', email: 'mxp@gie.local' },
  { username: 'jkamga', displayName: 'Jean Kamga', email: 'jkamga@gie.local' },
  { username: 'mnkolo', displayName: 'Marie Nkolo', email: 'mnkolo@gie.local' },
  { username: 'pfotso', displayName: 'Paul Fotso', email: 'pfotso@gie.local' },
  { username: 'ctchoua', displayName: 'Claire Tchoua', email: 'ctchoua@gie.local' },
  { username: 'ssv8mob', displayName: 'Service Mobile SSV8', email: null },
  { username: 'gltmadmin', displayName: 'Administrateur LTM', email: 'gltmadmin@gie.local' },
];

export class DevDirectory implements Directory {
  readonly kind = 'dev' as const;
  private readonly logger = new Logger(DevDirectory.name);

  constructor() {
    this.logger.warn(
      "AUTH_MODE=dev : le mot de passe n'est PAS vérifié. Seule l'appartenance à la liste des " +
        "utilisateurs est contrôlée. Ce mode est réservé au développement et refusé en production.",
    );
  }

  async isReachable(): Promise<boolean> {
    return true;
  }

  async authenticate(username: string, _password: string): Promise<DirectoryAuthResult> {
    this.logger.warn(`Authentification acceptée sans vérification du mot de passe pour « ${username} » (AUTH_MODE=dev)`);
    return { authenticated: true };
  }

  async search(needle: string, limit: number): Promise<DirectoryPerson[]> {
    const recherche = needle.toLowerCase();
    return ANNUAIRE_SIMULE.filter(
      (personne) =>
        personne.username.toLowerCase().includes(recherche) ||
        personne.displayName.toLowerCase().includes(recherche) ||
        (personne.email ?? '').toLowerCase().includes(recherche),
    ).slice(0, limit);
  }

  async findByUsername(username: string): Promise<DirectoryPerson | null> {
    const recherche = username.toLowerCase();
    return ANNUAIRE_SIMULE.find((personne) => personne.username.toLowerCase() === recherche) ?? null;
  }
}
