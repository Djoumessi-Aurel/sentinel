/**
 * Utilisateur porté par la requête. En Phase 1-3 il est factice, mais sa forme
 * est déjà celle de la Phase 4 : les contrôleurs peuvent écrire
 * `@CurrentUser() user: RequestUser` dès maintenant, sans changement de
 * signature quand l'authentification réelle arrivera (docs/AUTH.md §1).
 */
export interface RequestUser {
  id: string;
  role: 'admin' | 'viewer';
}

/** Utilisateur utilisé tant que le module d'authentification n'existe pas. */
export const SYSTEM_USER: RequestUser = { id: 'system', role: 'admin' };
