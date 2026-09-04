import { SetMetadata } from '@nestjs/common';

export const ALLOWED_DURING_ENROLLMENT = 'sentinel:allowed-during-enrollment';

/**
 * Route accessible avec une session **restreinte à l'appairage** de la double
 * authentification (docs/AUTH.md).
 *
 * Quand l'administration impose la 2FA, un compte qui ne l'a pas encore
 * configurée reçoit une session qui ne donne accès à rien d'autre que ces
 * quelques routes. La liste doit rester courte : tout ce qui s'y trouve est
 * atteignable sans second facteur.
 */
export const AllowedDuringEnrollment = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOWED_DURING_ENROLLMENT, true);
