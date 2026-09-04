import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Erreurs de base de données qui traduisent une **demande invalide**, et non une
 * panne : sans cette table, elles remontaient en 500, ce qui présentait une
 * faute de l'appelant comme une défaillance du serveur — et brouillait la
 * supervision, où un 500 doit rester un signal rare et sérieux.
 *
 * Les messages sont réécrits : ceux de Prisma nomment tables et colonnes
 * (OWASP A05).
 */
const ERREURS_BASE: Record<string, { statut: HttpStatus; message: string }> = {
  // Enregistrement requis mais absent : mise à jour ou suppression d'un
  // identifiant qui n'existe pas.
  P2025: { statut: HttpStatus.NOT_FOUND, message: 'Ressource introuvable' },
  // Contrainte d'unicité.
  P2002: { statut: HttpStatus.CONFLICT, message: 'Cette valeur existe déjà' },
  // Clé étrangère : on référence quelque chose qui n'existe pas.
  P2003: { statut: HttpStatus.BAD_REQUEST, message: 'Référence invalide' },
};

/**
 * Filtre d'exception global.
 *
 * Une pile d'appels ou un message d'erreur de driver renvoyé au client
 * renseigne un attaquant sur la structure interne (OWASP A05). On renvoie donc
 * un message générique accompagné d'un identifiant de corrélation, et on garde
 * le détail complet côté serveur : le support retrouve l'incident par cet
 * identifiant, sans rien exposer.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const correlationId = randomUUID();

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const connue = ERREURS_BASE[exception.code];
      if (connue) {
        response
          .status(connue.statut)
          .json({ statusCode: connue.statut, message: connue.message, correlationId });
        return;
      }
      // Code inattendu : c'est un vrai incident, on le journalise en entier.
      this.logger.error(
        `[${correlationId}] ${request.method} ${request.url} — Prisma ${exception.code}`,
        exception.message,
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Erreur interne du serveur',
        correlationId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Les erreurs 4xx sont explicatives par nature (validation, ressource
      // absente) : leur message est destiné à l'appelant et ne fuit rien.
      if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
        response.status(status).json(
          typeof body === 'string'
            ? { statusCode: status, message: body, correlationId }
            : { ...(body as Record<string, unknown>), statusCode: status, correlationId },
        );
        return;
      }

      this.logger.error(`[${correlationId}] ${request.method} ${request.url} — ${exception.message}`, exception.stack);
    } else {
      const detail = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`[${correlationId}] ${request.method} ${request.url} — exception non gérée`, detail);
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Erreur interne du serveur',
      correlationId,
    });
  }
}
