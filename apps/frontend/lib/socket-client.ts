'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_NAMESPACE,
  type AlertEvent,
  type AlertNewEvent,
  type AlertResolvedEvent,
  type ApplicationHealth,
  type LogNewEvent,
  type ServiceStatusChangedEvent,
  type StoredLogEntry,
} from '@sentinel/shared-types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';

/**
 * Nombre de lignes conservées en mémoire par le viewer.
 *
 * Un flux temps réel est illimité par nature : sans plafond, l'onglet grossit
 * jusqu'à devenir inutilisable au bout de quelques heures — exactement au
 * moment où on en a besoin. La recherche historique sert au-delà.
 */
const MAX_BUFFERED_LINES = 2000;

let sharedSocket: Socket | null = null;

/** Une seule connexion pour tout l'onglet, partagée entre les écrans. */
function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(`${WS_URL}${REALTIME_NAMESPACE}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
  }
  return sharedSocket;
}

export interface RealtimeState {
  connected: boolean;
  entries: StoredLogEntry[];
  alerts: AlertEvent[];
  health: ApplicationHealth | null;
  serviceChanges: ServiceStatusChangedEvent[];
  clear: () => void;
}

/**
 * Abonnement temps réel à une application (docs/FRONTEND.md §3).
 *
 * Le composant rejoint la room au montage et la quitte au démontage : un poste
 * ouvert sur une seule application ne reçoit pas le flux de tout le parc.
 */
export function useApplicationRealtime(applicationId: string | null, onAlert?: (alert: AlertEvent) => void): RealtimeState {
  const [connected, setConnected] = useState(false);
  const [entries, setEntries] = useState<StoredLogEntry[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [health, setHealth] = useState<ApplicationHealth | null>(null);
  const [serviceChanges, setServiceChanges] = useState<ServiceStatusChangedEvent[]>([]);

  // Référence plutôt que dépendance d'effet : sans cela, une fonction recréée à
  // chaque rendu ferait quitter puis rejoindre la room en boucle.
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  useEffect(() => {
    if (!applicationId) return;

    const socket = getSocket();
    const join = () => socket.emit('join', { applicationId });

    const handleConnect = () => {
      setConnected(true);
      join();
    };
    const handleDisconnect = () => setConnected(false);

    const handleLog = (payload: LogNewEvent) => {
      if (payload.applicationId !== applicationId) return;
      setEntries((current) => [payload.entry, ...current].slice(0, MAX_BUFFERED_LINES));
    };

    const handleAlert = (payload: AlertNewEvent) => {
      if (payload.applicationId !== applicationId) return;
      setHealth(payload.health);
      setAlerts((current) => [payload.alert, ...current.filter((alert) => alert.id !== payload.alert.id)].slice(0, 50));
      onAlertRef.current?.(payload.alert);
    };

    const handleResolved = (payload: AlertResolvedEvent) => {
      if (payload.applicationId !== applicationId) return;
      setHealth(payload.health);
      setAlerts((current) => current.filter((alert) => alert.id !== payload.alertId));
    };

    const handleService = (payload: ServiceStatusChangedEvent) => {
      if (payload.applicationId !== applicationId) return;
      setHealth(payload.health);
      setServiceChanges((current) => [payload, ...current].slice(0, 20));
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('log:new', handleLog);
    socket.on('alert:new', handleAlert);
    socket.on('alert:resolved', handleResolved);
    socket.on('service:status', handleService);

    if (socket.connected) handleConnect();

    return () => {
      socket.emit('leave', { applicationId });
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('log:new', handleLog);
      socket.off('alert:new', handleAlert);
      socket.off('alert:resolved', handleResolved);
      socket.off('service:status', handleService);
    };
  }, [applicationId]);

  return { connected, entries, alerts, health, serviceChanges, clear: () => setEntries([]) };
}
