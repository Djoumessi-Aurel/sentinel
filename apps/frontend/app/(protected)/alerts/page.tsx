'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AlertEvent, ApplicationSummary } from '@sentinel/shared-types';

import { ApiError, api } from '@/lib/api-client';

const PAGE_SIZE = 50;

/** Historique des alertes, filtrable (docs/API.md §6). */
export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [applicationId, setApplicationId] = useState('');
  const [status, setStatus] = useState<'active' | 'resolved' | ''>('active');
  const [severity, setSeverity] = useState<'critical' | 'warning' | ''>('');
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const names = new Map(applications.map((app) => [app.id, app.name]));

  const load = useCallback(async () => {
    try {
      const response = await api.alerts.list({
        applicationId: applicationId === '' ? undefined : applicationId,
        status: status === '' ? undefined : status,
        severity: severity === '' ? undefined : severity,
        pageSize: PAGE_SIZE,
      });
      setAlerts(response.items);
      setTotal(response.total);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
    }
  }, [applicationId, status, severity]);

  useEffect(() => {
    void api.applications.list().then(setApplications).catch(() => undefined);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Alertes</h1>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-white/10 bg-surface-raised p-4 text-sm">
        <label>
          <span className="mb-1 block text-slate-400">Application</span>
          <select
            value={applicationId}
            onChange={(event) => setApplicationId(event.target.value)}
            className="rounded border border-white/10 bg-surface px-3 py-1.5 text-slate-200"
          >
            <option value="">Toutes</option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-slate-400">Statut</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="rounded border border-white/10 bg-surface px-3 py-1.5 text-slate-200"
          >
            <option value="active">Actives</option>
            <option value="resolved">Résolues</option>
            <option value="">Toutes</option>
          </select>
        </label>

        <label>
          <span className="mb-1 block text-slate-400">Gravité</span>
          <select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as typeof severity)}
            className="rounded border border-white/10 bg-surface px-3 py-1.5 text-slate-200"
          >
            <option value="">Toutes</option>
            <option value="critical">Critique</option>
            <option value="warning">Avertissement</option>
          </select>
        </label>

        <span className="ml-auto text-xs text-slate-500">{total} alerte(s)</span>
      </div>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}

      <div className="space-y-2">
        {alerts.length === 0 && (
          <p className="rounded-lg border border-white/10 bg-surface-raised p-6 text-center text-sm text-slate-500">
            Aucune alerte pour ces critères.
          </p>
        )}

        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`rounded-lg border bg-surface-raised p-3 ${
              alert.resolvedAt
                ? 'border-white/10 opacity-70'
                : alert.severity === 'critical'
                  ? 'border-red-500/30'
                  : 'border-amber-500/30'
            }`}
          >
            <div className="flex flex-wrap items-start gap-3">
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                  alert.severity === 'critical' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {alert.severity === 'critical' ? 'Critique' : 'Avert.'}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200">{alert.message}</p>
                <p className="mt-1 text-xs text-slate-500">
                  <Link href={`/applications/${alert.applicationId}/live`} className="hover:text-sky-400">
                    {names.get(alert.applicationId) ?? alert.applicationId}
                  </Link>
                  {' · déclenchée le '}
                  {new Date(alert.triggeredAt).toLocaleString('fr-FR')}
                  {alert.resolvedAt && ` · résolue le ${new Date(alert.resolvedAt).toLocaleString('fr-FR')}`}
                </p>

                {/* Statut d'envoi par canal : c'est ici qu'on voit qu'un SMS n'est
                    pas parti, ce qu'aucun autre écran ne dirait. */}
                {alert.channelsNotified.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {alert.channelsNotified.map((channel) => (
                      <span
                        key={channel.channel}
                        title={channel.detail}
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          channel.status === 'sent'
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : channel.status === 'failed'
                              ? 'bg-red-500/10 text-red-300'
                              : 'bg-slate-500/10 text-slate-400'
                        }`}
                      >
                        {channel.channel} : {channel.status === 'sent' ? 'envoyé' : channel.status === 'failed' ? 'échec' : 'ignoré'}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {!alert.resolvedAt && (
                <button
                  type="button"
                  onClick={() => void api.alerts.resolve(alert.id).then(load)}
                  className="shrink-0 rounded border border-white/10 px-2 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200"
                >
                  Résoudre
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
