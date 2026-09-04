'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { KNOWN_CHECK_TYPES, type Application, type MonitoredService } from '@sentinel/shared-types';

import { ServiceStateDot } from '@/components/app-status-badge';
import { ApiError, api } from '@/lib/api-client';

/**
 * Gestion des services surveillés d'une application (docs/FRONTEND.md §2).
 *
 * Ajouter un service ici crée automatiquement ses règles `service-status` et
 * `service-silence` côté backend, et l'agent récupère la nouvelle liste à son
 * prochain rafraîchissement — sans intervention sur le serveur.
 */
export default function ServicesPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id ?? '';

  const [application, setApplication] = useState<Application | null>(null);
  const [services, setServices] = useState<MonitoredService[]>([]);
  const [name, setName] = useState('');
  const [checkType, setCheckType] = useState<string>('systemd');
  const [critical, setCritical] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!applicationId) return;
    try {
      const [app, list] = await Promise.all([api.applications.get(applicationId), api.services.list(applicationId)]);
      setApplication(app);
      setServices(list);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await api.services.create(applicationId, { name: name.trim(), checkType, critical });
      setName('');
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (service: MonitoredService) => {
    if (!confirm(`Retirer « ${service.name} » de la surveillance ? Ses règles d'alerte seront supprimées.`)) return;
    try {
      await api.services.remove(service.id);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Suppression impossible');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/applications/${applicationId}/live`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {application?.name ?? 'Application'}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Services surveillés</h1>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <label className="flex-1 min-w-[240px] text-sm">
          <span className="mb-1 block text-slate-600">Nom du service</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="httpd.service, api, mobileapi.jar…"
            className="w-full rounded border border-slate-200 bg-surface px-3 py-1.5 font-mono text-sm text-slate-800 placeholder:text-slate-400"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Type de vérification</span>
          <select
            value={checkType}
            onChange={(event) => setCheckType(event.target.value)}
            className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-sm text-slate-800"
          >
            {KNOWN_CHECK_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={critical} onChange={(event) => setCritical(event.target.checked)} />
          Critique
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded bg-sky-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          Ajouter
        </button>
      </form>

      <p className="text-xs text-slate-500">
        Un service critique fait basculer le statut de l’application. Un service non critique alerte, sans faire passer
        l’application en rouge — utile pour un composant annexe comme l’updater de LTM.
      </p>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Service</th>
              <th className="px-4 py-2 font-medium">Vérification</th>
              <th className="px-4 py-2 font-medium">État</th>
              <th className="px-4 py-2 font-medium">Dernier contrôle</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {services.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  Aucun service surveillé pour cette application.
                </td>
              </tr>
            )}
            {services.map((service) => (
              <tr key={service.id} className="bg-surface-raised">
                <td className="px-4 py-2 font-mono">
                  {service.name}
                  {!service.critical && <span className="ml-2 text-xs text-slate-400">non critique</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">{service.checkType}</td>
                <td className="px-4 py-2">
                  <ServiceStateDot state={service.lastState} />
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {service.lastCheckedAt ? new Date(service.lastCheckedAt).toLocaleString('fr-FR') : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void remove(service)}
                    className="text-xs text-slate-500 hover:text-red-700"
                  >
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
