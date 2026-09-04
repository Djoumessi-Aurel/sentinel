import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';

/**
 * Adaptateur Socket.IO appliquant la même politique d'origines que l'API REST.
 *
 * Un WebSocket ouvert à toutes les origines annule l'intérêt du CORS posé sur
 * les routes HTTP : n'importe quelle page pourrait ouvrir une connexion et lire
 * le flux de logs en direct (docs/SECURITY.md A05).
 */
export class SecureIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.allowedOrigins,
        credentials: true,
      },
    });
  }
}
