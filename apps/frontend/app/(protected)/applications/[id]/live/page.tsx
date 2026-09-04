'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_DISPLAY_COLORS,
  type AlertEvent,
  type AppConfig,
  type Application,
  type ApplicationServicesStatus,
  type StoredLogEntry,
} from '@sentinel/shared-types';

import { AppStatusBadge, ServiceStateDot } from '@/components/app-status-badge';
import { LogViewer } from '@/components/log-viewer';
import { ApiError, api } from '@/lib/api-client';
import { useApplicationRealtime } from '@/lib/socket-client';

/** Nombre de lignes récentes chargées au montage, avant la prise de relais du flux. */
const INITIAL_LINES = 200;


export default function LivePage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id ?? null;

  const [application, setApplication] = useState<Application | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [services, setServices] = useState<ApplicationServicesStatus | null>(null);
  const [history, setHistory] = useState<StoredLogEntry[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playAlertSound = useAlertSound(config?.alertChannels.sound ?? false);

  const realtime = useApplicationRealtime(applicationId, playAlertSound);

  const load = useCallback(async () => {
    if (!applicationId) return;
    try {
      const [app, appConfig, status, logs, alerts] = await Promise.all([
        api.applications.get(applicationId),
        api.config.getApp(applicationId),
        api.services.status(applicationId),
        api.logs.search({ applicationId, pageSize: INITIAL_LINES }),
        api.alerts.list({ applicationId, status: 'active', pageSize: 20 }),
      ]);
      setApplication(app);
      setConfig(appConfig);
      setServices(status);
      setHistory(logs.items);
      setActiveAlerts(alerts.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Une alerte reçue en direct peut concerner un service : on rafraîchit alors
  // l'état des services, que le WebSocket ne transporte pas en entier.
  useEffect(() => {
    if (realtime.serviceChanges.length === 0 || !applicationId) return;
    void api.services.status(applicationId).then(setServices).catch(() => undefined);
  }, [realtime.serviceChanges, applicationId]);

  useEffect(() => {
    setActiveAlerts((current) => {
      const merged = [...realtime.alerts, ...current];
      return merged.filter((alert, index) => merged.findIndex((other) => other.id === alert.id) === index).slice(0, 20);
    });
  }, [realtime.alerts]);

  /**
   * Le flux temps réel s'empile devant l'historique chargé au montage.
   * En pause, on fige la vue : lire une erreur qui défile est impossible, et
   * c'est justement au moment de l'incident qu'on a besoin de la lire.
   */
  const frozen = useRef<StoredLogEntry[]>([]);
  const entries = useMemo(() => {
    const live = [...realtime.entries, ...history];
    const deduplicated = live.filter((entry, index) => live.findIndex((other) => other.id === entry.id) === index);
    const filtered = levelFilter === '' ? deduplicated : deduplicated.filter((entry) => entry.level === levelFilter);

    if (paused) return frozen.current;
    frozen.current = filtered;
    return filtered;
  }, [realtime.entries, history, levelFilter, paused]);

  const colors = config?.displayColors ?? DEFAULT_DISPLAY_COLORS;
  const health = realtime.health ?? (activeAlerts.length > 0 ? 'critical' : 'ok');

  if (error) {
    return <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>;
  }

  if (!application || !config) {
    return <p className="text-sm text-slate-500">Chargement…</p>;
  }

  const levels = [...new Set(entries.map((entry) => entry.level))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-300">
              ← Parc
            </Link>
            <h1 className="text-xl font-semibold tracking-tight">{application.name}</h1>
            <AppStatusBadge health={health} />
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">{application.logPath}</p>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/applications/${application.id}/services`}
            className="rounded border border-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/5"
          >
            Services
          </Link>
          <Link
            href={`/applications/${application.id}/history`}
            className="rounded border border-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/5"
          >
            Historique
          </Link>
        </div>
      </div>

      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          {activeAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                alert.severity === 'critical'
                  ? 'border-red-500/30 bg-red-500/5 text-red-200'
                  : 'border-amber-500/30 bg-amber-500/5 text-amber-200'
              }`}
            >
              <span className="mt-0.5 shrink-0 font-semibold uppercase tracking-wide">
                {alert.severity === 'critical' ? 'Critique' : 'Avertissement'}
              </span>
              <span className="min-w-0 flex-1">{alert.message}</span>
              <button
                type="button"
                onClick={() => void api.alerts.resolve(alert.id).then(load)}
                className="shrink-0 rounded border border-current/30 px-2 py-0.5 text-xs opacity-80 hover:opacity-100"
              >
                Résoudre
              </button>
            </div>
          ))}
        </div>
      )}

      {services && services.services.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-white/10 bg-surface-raised px-4 py-3">
          {services.services.map((service) => (
            <div key={service.id} className="flex items-center gap-2 text-sm">
              <ServiceStateDot state={service.lastState} />
              <span className={service.critical ? 'text-slate-300' : 'text-slate-500'}>
                {service.name}
                {!service.critical && <span className="ml-1 text-xs text-slate-600">(non critique)</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 text-xs ${realtime.connected ? 'text-emerald-400' : 'text-slate-500'}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${realtime.connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          {realtime.connected ? 'Flux temps réel connecté' : 'Flux déconnecté'}
        </span>

        <select
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value)}
          className="rounded border border-white/10 bg-surface-raised px-2 py-1 text-sm text-slate-300"
        >
          <option value="">Tous les niveaux</option>
          {levels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setPaused((current) => !current)}
          className={`rounded border px-3 py-1 text-sm ${
            paused ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-white/10 text-slate-300 hover:bg-white/5'
          }`}
        >
          {paused ? 'Reprendre le défilement' : 'Figer'}
        </button>

        <span className="ml-auto text-xs text-slate-500">{entries.length} ligne(s) affichée(s)</span>
      </div>

      <LogViewer entries={entries} colors={colors} />
    </div>
  );
}

/**
 * Son d'alerte, joué **entièrement côté client** : le backend notifie, le
 * navigateur décide (docs/ALERTING.md §2, docs/FRONTEND.md §3).
 * Le son est synthétisé via l'API Web Audio, sans fichier ni dépendance externe.
 */
function useAlertSound(enabled: boolean): (alert: AlertEvent) => void {
  const contextRef = useRef<AudioContext | null>(null);

  return useCallback(
    (alert: AlertEvent) => {
      if (!enabled || typeof window === 'undefined') return;
      try {
        contextRef.current ??= new AudioContext();
        const context = contextRef.current;
        // Les navigateurs suspendent le contexte tant que l'utilisateur n'a pas
        // interagi avec la page : on tente la reprise sans en faire une erreur.
        void context.resume();

        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = alert.severity === 'critical' ? 880 : 587;
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5);

        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.5);
      } catch {
        // Un son impossible à jouer ne doit jamais empêcher l'affichage de l'alerte.
      }
    },
    [enabled],
  );
}
