'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_DISPLAY_COLORS,
  KNOWN_LOG_LEVELS,
  type AppConfig,
  type Application,
  type StoredLogEntry,
} from '@sentinel/shared-types';

import { LogViewer } from '@/components/log-viewer';
import { ApiError, api } from '@/lib/api-client';


const PAGE_SIZE = 200;

/** Valeur par défaut du filtre : les dernières 24 heures. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const format = (date: Date) => date.toISOString().slice(0, 16);
  return { from: format(yesterday), to: format(now) };
}

/**
 * Recherche historique par plage de dates (docs/API.md §7).
 *
 * Les dates saisies sont locales ; elles sont converties en UTC avant d'être
 * envoyées, le stockage étant entièrement en UTC (docs/ARCHITECTURE.md §9).
 */
export default function HistoryPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id ?? '';

  const [application, setApplication] = useState<Application | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [range, setRange] = useState(defaultRange);
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ items: StoredLogEntry[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!applicationId) return;
    void Promise.all([api.applications.get(applicationId), api.config.getApp(applicationId)])
      .then(([app, appConfig]) => {
        setApplication(app);
        setConfig(appConfig);
      })
      .catch(() => undefined);
  }, [applicationId]);

  const search = useCallback(
    async (targetPage: number) => {
      if (!applicationId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await api.logs.search({
          applicationId,
          from: new Date(range.from).toISOString(),
          to: new Date(range.to).toISOString(),
          level: level === '' ? undefined : level,
          query: query.trim() === '' ? undefined : query.trim(),
          page: targetPage,
          pageSize: PAGE_SIZE,
        });
        setResult({ items: response.items, total: response.total });
        setPage(targetPage);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : 'Recherche impossible');
      } finally {
        setLoading(false);
      }
    },
    [applicationId, range, level, query],
  );

  useEffect(() => {
    void search(1);
    // Recherche initiale uniquement : les suivantes sont déclenchées par le formulaire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/applications/${applicationId}/live`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {application?.name ?? 'Application'}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Recherche historique</h1>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search(1);
        }}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-surface-raised p-4 text-sm"
      >
        <label>
          <span className="mb-1 block text-slate-600">Du</span>
          <input
            type="datetime-local"
            value={range.from}
            onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))}
            className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
          />
        </label>
        <label>
          <span className="mb-1 block text-slate-600">Au</span>
          <input
            type="datetime-local"
            value={range.to}
            onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))}
            className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
          />
        </label>
        <label>
          <span className="mb-1 block text-slate-600">Niveau</span>
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
          >
            <option value="">Tous</option>
            {KNOWN_LOG_LEVELS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 min-w-[220px]">
          <span className="mb-1 block text-slate-600">Contient</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="texte recherché dans le message"
            className="w-full rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800 placeholder:text-slate-400"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-sky-700 px-4 py-1.5 font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {loading ? 'Recherche…' : 'Rechercher'}
        </button>
      </form>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {result.total} résultat(s) — page {page} sur {lastPage}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => void search(page - 1)}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
          >
            Précédent
          </button>
          <button
            type="button"
            disabled={page >= lastPage || loading}
            onClick={() => void search(page + 1)}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
          >
            Suivant
          </button>
        </div>
      </div>

      <LogViewer
        entries={result.items}
        colors={config?.displayColors ?? DEFAULT_DISPLAY_COLORS}
        emptyMessage="Aucun log sur cette plage."
      />
    </div>
  );
}
