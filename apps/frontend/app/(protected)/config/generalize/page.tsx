'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ApplicationSummary, GlobalConfig } from '@sentinel/shared-types';

import { ApiError, api } from '@/lib/api-client';

/**
 * Généralisation de la configuration globale (docs/CONFIG_MANAGEMENT.md §3).
 *
 * Deux garde-fous délibérés :
 *  - **rien n'est coché par défaut**, pour qu'aucun écrasement ne parte d'un
 *    simple clic sur « Valider » ;
 *  - la liste indique quelles applications ont dérivé de la config globale, pour
 *    qu'on sache ce qu'on écrase avant de le faire.
 */
export default function GeneralizePage() {
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
  const [diverged, setDiverged] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [apps, global] = await Promise.all([api.applications.list(), api.config.getGlobal()]);
        setApplications(apps);
        setGlobalConfig(global);

        // Comparaison simple des objets JSON, comme le prévoit la spécification :
        // savoir *quelles* applis ont dérivé est ce qui permet de décider quoi cocher.
        const divergedIds = new Set<string>();
        await Promise.all(
          apps.map(async (app) => {
            try {
              const config = await api.config.getApp(app.id);
              if (JSON.stringify(config.displayColors) !== JSON.stringify(global.displayColors)) {
                divergedIds.add(app.id);
              }
            } catch {
              // Une config illisible ne doit pas empêcher d'afficher la liste.
            }
          }),
        );
        setDiverged(divergedIds);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
      }
    })();
  }, []);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Écraser l'affichage et les canaux d'alerte de ${selected.size} application(s) ?`)) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.config.generalize([...selected]);
      setResult(`${response.updated.length} application(s) alignée(s) sur la configuration globale.`);
      setSelected(new Set());
      setDiverged((current) => {
        const next = new Set(current);
        for (const id of response.updated) next.delete(id);
        return next;
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Généralisation impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Généraliser la configuration</h1>
        <p className="mt-1 text-sm text-slate-500">
          Écrase les couleurs d’affichage et les canaux d’alerte des applications cochées avec les valeurs de la{' '}
          <Link href="/config/global" className="text-sky-700 hover:text-sky-900">
            configuration globale
          </Link>{' '}
          actuelle. L’opération est transactionnelle : toutes les applications cochées, ou aucune.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        Les heures creuses, les règles d’analyse et les services surveillés ne sont pas concernés : ce sont des réglages
        propres à chaque application, pas des préférences d’affichage à propager.
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {result && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700">{result}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-4 py-2" />
              <th className="px-4 py-2 font-medium">Application</th>
              <th className="px-4 py-2 font-medium">Serveur</th>
              <th className="px-4 py-2 font-medium">Affichage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {applications.map((app) => (
              <tr key={app.id} className="bg-surface-raised">
                <td className="px-4 py-2">
                  <input type="checkbox" checked={selected.has(app.id)} onChange={() => toggle(app.id)} />
                </td>
                <td className="px-4 py-2">{app.name}</td>
                <td className="px-4 py-2 text-slate-500">{app.serverName}</td>
                <td className="px-4 py-2">
                  {diverged.has(app.id) ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      différent du global
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">aligné</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void apply()}
          disabled={busy || selected.size === 0 || !globalConfig}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-40"
        >
          {busy ? 'Application…' : `Généraliser vers ${selected.size} application(s)`}
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set(applications.map((app) => app.id)))}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          Tout sélectionner
        </button>
      </div>
    </div>
  );
}
