import type { CurrentUser, UserRole } from '@sentinel/shared-types';

/**
 * Utilisateur porté par la requête, peuplé par `AuthGuard`.
 *
 * Le type n'a pas changé de forme depuis la Phase 1, où il était rempli avec un
 * utilisateur factice : les contrôleurs écrivaient déjà `@CurrentUser() user`,
 * et aucun n'a eu à être modifié quand l'authentification réelle est arrivée
 * (docs/AUTH.md §1).
 */
export interface RequestUser {
  /** `sAMAccountName`, ou nom du compte technique. */
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  builtin: boolean;
  /** Session ouverte uniquement pour appairer la double authentification. */
  mustEnrollTwoFactor: boolean;
}

export const toRequestUser = (user: CurrentUser): RequestUser => ({
  id: user.username,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  builtin: user.builtin,
  mustEnrollTwoFactor: user.mustEnrollTwoFactor === true,
});
