import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'sentinel:public-route';

/**
 * Marque une route accessible sans session.
 *
 * Réservé à ce qui doit fonctionner **avant** toute connexion : la page de
 * connexion elle-même et la sonde de disponibilité. Toute autre route reste
 * protégée par défaut — c'est le sens de l'inversion : on n'oublie pas de
 * protéger, on choisit explicitement d'ouvrir (docs/SECURITY.md A01).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);
