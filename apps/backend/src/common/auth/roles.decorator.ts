import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@sentinel/shared-types';

export const REQUIRED_ROLES = 'sentinel:required-roles';

/**
 * Restreint une route à certains rôles (docs/AUTH.md §2.5).
 *
 * `RolesGuard` est distinct de `AuthGuard` : l'un répond « qui es-tu », l'autre
 * « as-tu le droit ». Les séparer permettra d'affiner les rôles plus tard sans
 * retoucher à l'authentification.
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_ROLES, roles);
