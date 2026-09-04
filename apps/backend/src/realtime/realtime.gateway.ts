import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import { GLOBAL_ALERTS_ROOM, REALTIME_NAMESPACE, applicationRoom } from '@sentinel/shared-types';
import { z } from 'zod';
import type { Server, Socket } from 'socket.io';

import {
  INTERNAL_EVENTS,
  type AlertResolvedEvent,
  type AlertTriggeredEvent,
  type LogIngestedEvent,
  type ServiceStateChangedEvent,
} from '../events';
import { HealthService } from '../alerting/health.service';

/** Le payload d'abonnement vient du navigateur : il est validé comme tout le reste. */
const joinSchema = z.object({ applicationId: z.string().uuid() });

/**
 * Diffusion temps réel (docs/API.md §8).
 *
 * Chaque client s'abonne explicitement aux applications affichées à l'écran :
 * pas de diffusion globale, sans quoi un poste ouvert sur une seule appli
 * recevrait le flux de tout le parc.
 */
// Les origines autorisées ne sont pas déclarées ici : un décorateur est évalué
// au chargement de la classe, avant que l'environnement validé soit injectable.
// Elles sont appliquées par `SecureIoAdapter` au démarrage (docs/SECURITY.md A05).
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly health: HealthService) {}

  handleConnection(client: Socket): void {
    this.logger.debug(`Client temps réel connecté : ${client.id}`);
  }

  @SubscribeMessage('join')
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): { joined: string } | { error: string } {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return { error: 'applicationId invalide' };

    void client.join(applicationRoom(parsed.data.applicationId));
    return { joined: parsed.data.applicationId };
  }

  @SubscribeMessage('leave')
  handleLeave(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): { left: string } | { error: string } {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return { error: 'applicationId invalide' };

    void client.leave(applicationRoom(parsed.data.applicationId));
    return { left: parsed.data.applicationId };
  }

  /**
   * Abonnement au flux d'alertes de tout le parc.
   *
   * Sans lui, une alerte n'était audible que par un poste ouvert précisément sur
   * la page temps réel de l'application concernée — donc jamais depuis le
   * tableau de bord, la liste des alertes, ou une télévision d'open space.
   */
  @SubscribeMessage('joinGlobalAlerts')
  handleJoinGlobalAlerts(@ConnectedSocket() client: Socket): { joined: string } {
    void client.join(GLOBAL_ALERTS_ROOM);
    return { joined: GLOBAL_ALERTS_ROOM };
  }

  @SubscribeMessage('leaveGlobalAlerts')
  handleLeaveGlobalAlerts(@ConnectedSocket() client: Socket): { left: string } {
    void client.leave(GLOBAL_ALERTS_ROOM);
    return { left: GLOBAL_ALERTS_ROOM };
  }

  @OnEvent(INTERNAL_EVENTS.logIngested)
  onLogIngested(event: LogIngestedEvent): void {
    const room = this.server.to(applicationRoom(event.applicationId));
    for (const entry of event.entries) {
      room.emit('log:new', { applicationId: event.applicationId, entry });
    }
  }

  @OnEvent(INTERNAL_EVENTS.alertTriggered)
  async onAlertTriggered(event: AlertTriggeredEvent): Promise<void> {
    const health = await this.health.computeHealth(event.applicationId);
    // `.to(a).to(b)` déduplique : un client abonné aux deux rooms ne reçoit
    // l'alerte qu'une fois, et ne la signale donc pas deux fois.
    this.server.to(applicationRoom(event.applicationId)).to(GLOBAL_ALERTS_ROOM).emit('alert:new', {
      applicationId: event.applicationId,
      applicationName: event.applicationName,
      alert: event.alert,
      health,
    });
  }

  @OnEvent(INTERNAL_EVENTS.alertResolved)
  async onAlertResolved(event: AlertResolvedEvent): Promise<void> {
    const health = await this.health.computeHealth(event.applicationId);
    this.server
      .to(applicationRoom(event.applicationId))
      .to(GLOBAL_ALERTS_ROOM)
      .emit('alert:resolved', { applicationId: event.applicationId, alertId: event.alertId, health });
  }

  @OnEvent(INTERNAL_EVENTS.serviceStateChanged)
  async onServiceStateChanged(event: ServiceStateChangedEvent): Promise<void> {
    const health = await this.health.computeHealth(event.applicationId);
    this.server.to(applicationRoom(event.applicationId)).emit('service:status', {
      applicationId: event.applicationId,
      serviceId: event.serviceId,
      serviceName: event.serviceName,
      previousState: event.previousState,
      newState: event.newState,
      health,
    });
  }
}
