import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validation d'entrée par schéma Zod (docs/SECURITY.md A03).
 *
 * Zod plutôt que class-validator : les mêmes schémas sont déjà partagés avec le
 * frontend via `packages/shared-types`, ce qui garantit qu'un contrat ne peut
 * pas diverger entre les deux côtés — `API.md §9` autorise explicitement l'un
 * ou l'autre. Les schémas sont `z.object` stricts : tout champ inconnu est
 * rejeté plutôt que silencieusement ignoré.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    // On renvoie le chemin et le message, jamais la valeur reçue : elle peut
    // contenir une donnée sensible qui se retrouverait dans les logs du client.
    throw new BadRequestException({
      message: 'Requête invalide',
      errors: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}

/** Fabrique, pour écrire `@Body(zodBody(createApplicationSchema))`. */
export const zodBody = <T>(schema: ZodSchema<T>): ZodValidationPipe<T> => new ZodValidationPipe(schema);
