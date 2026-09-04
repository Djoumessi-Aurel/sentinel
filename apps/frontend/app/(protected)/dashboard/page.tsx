'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ApplicationHealth, ApplicationSummary } from '@sentinel/shared-types';

import { AppStatusBadge } from '@/components/app-status-badge';
import { ApiError, api } from '@/lib/api-client';

/**
 * Vue d'ensemble du parc (docs/FRONTEND.md §4).
 *
 * Objectif direct du besoin exprimé : d'un coup d'œil, savoir si un problème est
 * en cours quelque part — sans attendre qu'un utilisateur le signale. D'où le
 * tri par gravité : ce qui va mal est en haut, toujours.
 */
const HEALTH_ORDER: Record<ApplicationHealth, number> = { critical: 0, warning: 1, silent: 2, ok: 3 };

/** Rafraîchissement de la liste. Le détail temps réel est sur la page de chaque appli. */
const REFRESH_INTERVAL_MS = 10_000;

export default function DashboardPage() {
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const list = await api.applications.list();
      setApplications([...list].sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || a.name.localeCompare(b.name)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const counts = applications.reduce<Record<ApplicationHealth, number>>(
    (acc, app) => ({ ...acc, [app.health]: acc[app.health] + 1 }),
    { ok: 0, warning: 0, critical: 0, silent: 0 },
  );

  if (loading) {
    return <p className="text-sm text-slate-500">Chargement du parc…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
        <p className="font-medium">{error}</p>
        <p className="mt-1 text-red-300/70">Vérifier que le backend est démarré : npm run dev:backend</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="mt-1 text-sm text-slate-500">
            {applications.length} application(s) supervisée(s) — actualisé toutes les 10 secondes
          </p>
        </div>

        <div className="flex gap-2 text-sm">
          <Counter label="Critique" value={counts.critical} tone="text-red-300 ring-red-500/30 bg-red-500/5" />
          <Counter label="Avertissement" value={counts.warning} tone="text-amber-300 ring-amber-500/30 bg-amber-500/5" />
          <Counter label="Opérationnel" value={counts.ok} tone="text-emerald-300 ring-emerald-500/30 bg-emerald-500/5" />
        </div>
      </div>

      {applications.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-surface-raised p-8 text-center text-sm text-slate-500">
          Aucune application déclarée. Lancer <code className="text-slate-300">npm run db:seed</code> pour charger le parc.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {applications.map((app) => (
            <Link
              key={app.id}
              href={`/applications/${app.id}/live`}
              className={`group rounded-lg border bg-surface-raised p-4 transition hover:border-sky-500/40 ${
                app.health === 'critical' ? 'border-red-500/30' : 'border-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-medium group-hover:text-sky-300">{app.name}</h2>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {app.serverName} · {app.type}
                  </p>
                </div>
                <AppStatusBadge health={app.health} size="sm" />
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Metric label="Alertes" value={app.activeAlertCount} warn={app.activeAlertCount > 0} />
                <Metric
                  label="Services HS"
                  value={`${app.servicesDown}/${app.servicesTotal}`}
                  warn={app.servicesDown > 0}
                />
                <Metric label="Dernier log" value={formatRelative(app.lastLogAt)} warn={isStale(app.lastLogAt)} />
              </dl>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-lg px-3 py-1.5 ring-1 ${tone}`}>
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="ml-1.5 text-xs opacity-80">{label}</span>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-0.5 font-medium tabular-nums ${warn ? 'text-amber-300' : 'text-slate-300'}`}>{value}</dd>
    </div>
  );
}

/** Au-delà de 15 minutes sans log, on le signale : c'est le seuil de la règle `silence`. */
function isStale(lastLogAt: string | null): boolean {
  if (!lastLogAt) return true;
  return Date.now() - new Date(lastLogAt).getTime() > 15 * 60_000;
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'jamais';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86_400)} j`;
}
