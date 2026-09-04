import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

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
