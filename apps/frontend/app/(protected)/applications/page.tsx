'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ApplicationSummary, CreatedApplication, Server } from '@sentinel/shared-types';

import { AppStatusBadge } from '@/components/app-status-badge';
import { ApiError, api } from '@/lib/api-client';
import { AdminOnly } from '@/components/admin-only';

/**
 * Déclaration et gestion des applications supervisées.
 *
 * C'est l'étape 3 de `docs/AGENT_SETUP.md`, et le seul endroit où le **token
 * d'agent** est visible : il n'est affiché qu'une fois, à la création, et n'est
 * ensuite plus jamais consultable — la base n'en garde qu'une empreinte.
 */

/** Chemins de log habituels par type, repris de `agents/install.sh`. */
const DEFAULT_LOG_PATHS: Record<string, string> = {
  'spring-boot': '/var/log/application/*.log',
  'java-simple': '/var/log/application/*.log',
  distribcard: '/programs_data/programs/distribcard/logs/distribcard.log',
  'nodejs-pm2': '/root/.pm2/logs/*-out-*.log',
  'react-nginx': '/var/log/nginx/*.log',
  generic: '/var/log/*.log',
};

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Type proposé par défaut. Volontairement `generic` : les types arrivent triés
 * par ordre alphabétique, et laisser `distribcard` en tête ferait parser de
 * travers toute application créée sans y prêter attention — silencieusement.
 * Le parseur générique, lui, ne se trompe jamais : il détecte le niveau et
 * garde la ligne entière.
 */
const TYPE_PAR_DEFAUT = 'generic';

const typeInitial = (types: string[]): string =>
  types.includes(TYPE_PAR_DEFAUT) ? TYPE_PAR_DEFAUT : (types[0] ?? TYPE_PAR_DEFAUT);

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [cree, setCree] = useState<CreatedApplication | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [apps, srv, { types: liste }] = await Promise.all([
        api.applications.list(),
        api.servers.list(),
        api.applications.types(),
      ]);
      setApplications(apps);
      setServers(srv);
      setTypes(liste);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const supprimer = async (app: ApplicationSummary) => {
    if (
      !confirm(
        `Supprimer « ${app.name} » ? Sa configuration, ses règles, ses services surveillés et son historique d’alertes seront perdus.`,
      )
    ) {
      return;
    }
    try {
      await api.applications.remove(app.id);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Suppression impossible');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Applications supervisées</h1>
          <p className="mt-1 text-sm text-slate-500">
            {applications.length} application(s) déclarée(s) sur {servers.length} serveur(s)
          </p>
        </div>
        <AdminOnly>
          <button
            type="button"
            onClick={() => {
              setOuvert((v) => !v);
              setCree(null);
            }}
            className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
          >
            {ouvert ? 'Annuler' : 'Ajouter une application'}
          </button>
        </AdminOnly>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {cree && <TokenPanel created={cree} onClose={() => setCree(null)} />}

      {ouvert && !cree && (
        <FormulaireCreation
          servers={servers}
          types={types}
          onCree={async (resultat) => {
            setCree(resultat);
            setOuvert(false);
            await load();
          }}
          onServeurCree={load}
          onErreur={setError}
        />
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-surface-raised text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Application</th>
              <th className="px-4 py-2 font-medium">Serveur</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Fichier suivi</th>
              <th className="px-4 py-2 font-medium">État</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {applications.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Aucune application déclarée.
                </td>
              </tr>
            )}
            {applications.map((app) => (
              <tr key={app.id} className="bg-surface-raised">
                <td className="px-4 py-2">
                  <Link href={`/applications/${app.id}/live`} className="font-medium text-sky-700 hover:text-sky-900">
                    {app.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-500">{app.serverName}</td>
                <td className="px-4 py-2 text-slate-500">{app.type}</td>
                <td className="max-w-[280px] truncate px-4 py-2 font-mono text-xs text-slate-500" title={app.logPath}>
                  {app.logPath}
                </td>
                <td className="px-4 py-2">
                  <AppStatusBadge health={app.health} size="sm" />
                </td>
                <td className="px-4 py-2 text-right">
                  <AdminOnly>
                    <button
                      type="button"
                      onClick={() => void supprimer(app)}
                      className="text-xs text-slate-500 hover:text-red-700"
                    >
                      Supprimer
                    </button>
                  </AdminOnly>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormulaireCreation({
  servers,
  types,
  onCree,
  onServeurCree,
  onErreur,
}: {
  servers: Server[];
  types: string[];
  onCree: (resultat: CreatedApplication) => Promise<void>;
  onServeurCree: () => Promise<void>;
  onErreur: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState(() => typeInitial(types));
  const [serverId, setServerId] = useState(servers[0]?.id ?? '');
  const [logPath, setLogPath] = useState(() => DEFAULT_LOG_PATHS[typeInitial(types)] ?? '');
  const [nouveauServeur, setNouveauServeur] = useState({ ouvert: false, name: '', host: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!serverId && servers[0]) setServerId(servers[0].id);
  }, [servers, serverId]);

  const changerType = (valeur: string) => {
    setType(valeur);
    // Le chemin par défaut suit le type tant que l'utilisateur ne l'a pas
    // personnalisé : c'est ce qu'il aurait tapé dans neuf cas sur dix.
    const attendu = DEFAULT_LOG_PATHS[type];
    if (logPath === '' || logPath === attendu) setLogPath(DEFAULT_LOG_PATHS[valeur] ?? '');
  };

  const creerServeur = async () => {
    if (nouveauServeur.name.trim() === '' || nouveauServeur.host.trim() === '') return;
    setBusy(true);
    try {
      const serveur = await api.servers.create({ name: nouveauServeur.name.trim(), host: nouveauServeur.host.trim() });
      await onServeurCree();
      setServerId(serveur.id);
      setNouveauServeur({ ouvert: false, name: '', host: '' });
    } catch (cause) {
      onErreur(cause instanceof ApiError ? cause.message : 'Création du serveur impossible');
    } finally {
      setBusy(false);
    }
  };

  const soumettre = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim() === '' || serverId === '') return;
    setBusy(true);
    try {
      const resultat = await api.applications.create({
        name: name.trim(),
        type,
        serverId,
        logPath: logPath.trim(),
      });
      await onCree(resultat);
    } catch (cause) {
      const detail =
        cause instanceof ApiError && cause.details?.length
          ? `${cause.message} — ${cause.details.map((d) => `${d.path} : ${d.message}`).join(' ; ')}`
          : cause instanceof ApiError
            ? cause.message
            : 'Création impossible';
      onErreur(detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={soumettre} className="space-y-4 rounded-lg border border-slate-200 bg-surface-raised p-4">
      <div className="flex flex-wrap gap-4">
        <label className="min-w-[200px] flex-1 text-sm">
          <span className="mb-1 block text-slate-600">Nom</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="filemanager"
            className="w-full rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800 placeholder:text-slate-400"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Type</span>
          <select
            value={type}
            onChange={(e) => changerType(e.target.value)}
            className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
          >
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Serveur</span>
          <span className="flex items-center gap-2">
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
            >
              {servers.length === 0 && <option value="">aucun serveur</option>}
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.host})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setNouveauServeur((v) => ({ ...v, ouvert: !v.ouvert }))}
              className="rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              + serveur
            </button>
          </span>
        </label>
      </div>

      {nouveauServeur.ouvert && (
        <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-surface p-3 text-sm">
          <label>
            <span className="mb-1 block text-slate-600">Nom du serveur</span>
            <input
              value={nouveauServeur.name}
              onChange={(e) => setNouveauServeur((v) => ({ ...v, name: e.target.value }))}
              placeholder="filemanager"
              className="rounded border border-slate-200 bg-surface-raised px-3 py-1.5 text-slate-800 placeholder:text-slate-400"
            />
          </label>
          <label>
            <span className="mb-1 block text-slate-600">Adresse</span>
            <input
              value={nouveauServeur.host}
              onChange={(e) => setNouveauServeur((v) => ({ ...v, host: e.target.value }))}
              placeholder="10.11.20.207"
              className="rounded border border-slate-200 bg-surface-raised px-3 py-1.5 font-mono text-slate-800 placeholder:text-slate-400"
            />
          </label>
          <button
            type="button"
            onClick={() => void creerServeur()}
            disabled={busy}
            className="rounded border border-sky-700 px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-50 disabled:opacity-50"
          >
            Créer le serveur
          </button>
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Fichier(s) de log à suivre</span>
        <input
          value={logPath}
          onChange={(e) => setLogPath(e.target.value)}
          placeholder="/fmanager/logs/manager.log"
          className="w-full rounded border border-slate-200 bg-surface px-3 py-1.5 font-mono text-sm text-slate-800 placeholder:text-slate-400"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Chemin sur le serveur applicatif. Les motifs sont acceptés (<code>*.log</code>).
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || name.trim() === '' || serverId === ''}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-40"
        >
          {busy ? 'Création…' : 'Créer l’application'}
        </button>
        <span className="text-xs text-slate-500">
          Sa configuration et ses règles par défaut, dont la détection de silence, sont créées automatiquement.
        </span>
      </div>
    </form>
  );
}

/**
 * Affichage unique du token d'agent.
 *
 * Le token n'est jamais reconsultable : la base n'en conserve qu'une empreinte
 * (docs/SECURITY.md A02). D'où l'insistance visuelle, et la commande
 * d'installation fournie prête à coller — c'est le seul moment où elle peut
 * être composée.
 */
function TokenPanel({ created, onClose }: { created: CreatedApplication; onClose: () => void }) {
  const [copie, setCopie] = useState<'token' | 'commande' | null>(null);
  const { application, agentToken } = created;

  const commande = [
    'sudo ./install.sh',
    application.type,
    application.id,
    BACKEND_URL,
    agentToken,
    `"${application.logPath}"`,
  ].join(' ');

  const copier = async (valeur: string, quoi: 'token' | 'commande') => {
    try {
      await navigator.clipboard.writeText(valeur);
      setCopie(quoi);
      setTimeout(() => setCopie(null), 2000);
    } catch {
      // Presse-papiers refusé : la valeur reste sélectionnable à la main.
    }
  };

  return (
    <div className="space-y-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-amber-900">
            « {application.name} » créée — token d’agent à conserver maintenant
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            Ce token ne sera <strong>plus jamais affiché</strong> : seule son empreinte est conservée. En cas de perte,
            il faudra en régénérer un depuis l’application.
          </p>
        </div>
        <button type="button" onClick={onClose} className="shrink-0 text-sm text-amber-700 hover:text-amber-900">
          Fermer
        </button>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-amber-800">Token</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded border border-amber-300 bg-white px-3 py-2 font-mono text-sm text-slate-800">
            {agentToken}
          </code>
          <button
            type="button"
            onClick={() => void copier(agentToken, 'token')}
            className="shrink-0 rounded border border-amber-400 bg-white px-3 py-2 text-xs text-amber-900 hover:bg-amber-100"
          >
            {copie === 'token' ? 'Copié' : 'Copier'}
          </button>
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-amber-800">
          Commande d’installation, à exécuter sur {application.name}
        </span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-800">
            {commande}
          </code>
          <button
            type="button"
            onClick={() => void copier(commande, 'commande')}
            className="shrink-0 rounded border border-amber-400 bg-white px-3 py-2 text-xs text-amber-900 hover:bg-amber-100"
          >
            {copie === 'commande' ? 'Copiée' : 'Copier'}
          </button>
        </div>
        <p className="mt-1 text-xs text-amber-800">
          Ajouter <code className="font-mono">--services httpd.service,mysqld.service</code> pour installer aussi la
          vérification de statut, ou déclarer les services ensuite depuis l’écran « Services ».
        </p>
      </div>
    </div>
  );
}
