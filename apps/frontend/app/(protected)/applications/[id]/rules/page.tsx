'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { AnalyzerResult, AnalyzerRule, Application } from '@sentinel/shared-types';

import { ApiError, api } from '@/lib/api-client';
import { useIsAdmin } from '@/components/session-provider';

/**
 * Règles d'analyse d'une application (docs/FRONTEND.md §1, docs/ALERTING.md §1).
 *
 * Deux natures de règles cohabitent, et la distinction compte pour l'utilisateur :
 * celles qui portent sur les **logs**, qu'il configure librement, et celles
 * rattachées à un **service surveillé**, créées et supprimées automatiquement
 * avec lui. Les secondes ne s'éditent pas ici, sous peine de désynchroniser la
 * règle et le service qu'elle observe.
 */

const LIBELLES: Record<string, string> = {
  'level-threshold': 'Seuil sur un niveau de log',
  'pattern-rate': 'Taux de réussite',
  silence: 'Absence de logs',
  'service-status': 'État d’un service',
  'service-silence': 'Absence de vérification d’un service',
};

const RATTACHEE_A_UN_SERVICE = (type: string) => type === 'service-status' || type === 'service-silence';

export default function RulesPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id ?? '';

  const [application, setApplication] = useState<Application | null>(null);
  const [rules, setRules] = useState<AnalyzerRule[]>([]);
  const [resultats, setResultats] = useState<Record<string, AnalyzerResult>>({});
  const [enCours, setEnCours] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!applicationId) return;
    try {
      const [app, liste] = await Promise.all([api.applications.get(applicationId), api.rules.list(applicationId)]);
      setApplication(app);
      setRules(liste);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const basculer = async (rule: AnalyzerRule) => {
    try {
      await api.rules.setEnabled(rule.id, !rule.enabled);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Modification impossible');
    }
  };

  const tester = async (rule: AnalyzerRule) => {
    setEnCours(rule.id);
    try {
      const resultat = await api.rules.test(rule.id);
      setResultats((current) => ({ ...current, [rule.id]: resultat }));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Test impossible');
    } finally {
      setEnCours(null);
    }
  };

  const supprimer = async (rule: AnalyzerRule) => {
    if (!confirm(`Supprimer la règle « ${rule.name} » ?`)) return;
    try {
      await api.rules.remove(rule.id);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Suppression impossible');
    }
  };

  const reglesDeLogs = rules.filter((r) => !RATTACHEE_A_UN_SERVICE(r.type));
  const reglesDeServices = rules.filter((r) => RATTACHEE_A_UN_SERVICE(r.type));

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/applications/${applicationId}/live`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {application?.name ?? 'Application'}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Règles d’alerte</h1>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Règles sur les logs</h2>
        {reglesDeLogs.length === 0 && (
          <p className="rounded-lg border border-slate-200 bg-surface-raised p-4 text-sm text-slate-500">
            Aucune règle. Une application sans règle ne déclenche aucune alerte.
          </p>
        )}
        {reglesDeLogs.map((rule) => (
          <CarteRegle
            key={rule.id}
            rule={rule}
            resultat={resultats[rule.id]}
            enCours={enCours === rule.id}
            onBasculer={() => void basculer(rule)}
            onTester={() => void tester(rule)}
            onSupprimer={() => void supprimer(rule)}
          />
        ))}
      </section>

      {reglesDeServices.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-slate-700">Règles liées aux services surveillés</h2>
          <p className="text-xs text-slate-500">
            Créées et supprimées automatiquement avec leur service. Elles se gèrent depuis l’écran{' '}
            <Link href={`/applications/${applicationId}/services`} className="text-sky-700 hover:text-sky-900">
              Services
            </Link>
            , pour que la règle et le service qu’elle observe ne puissent pas se désynchroniser.
          </p>
          {reglesDeServices.map((rule) => (
            <CarteRegle
              key={rule.id}
              rule={rule}
              resultat={resultats[rule.id]}
              enCours={enCours === rule.id}
              onBasculer={() => void basculer(rule)}
              onTester={() => void tester(rule)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function CarteRegle({
  rule,
  resultat,
  enCours,
  onBasculer,
  onTester,
  onSupprimer,
}: {
  rule: AnalyzerRule;
  resultat: AnalyzerResult | undefined;
  enCours: boolean;
  onBasculer: () => void;
  onTester: () => void;
  onSupprimer?: () => void;
}) {
  // Activer, tester et supprimer une règle sont des écritures : le backend les
  // refuse à un lecteur (docs/AUTH.md §7).
  const admin = useIsAdmin();

  return (
    <div className={`rounded-lg border bg-surface-raised p-3 ${rule.enabled ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <label className="flex items-center gap-2 pt-0.5">
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={onBasculer}
            disabled={!admin}
            title={admin ? 'Activer ou désactiver' : 'Réservé aux administrateurs'}
          />
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{rule.name}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{rule.type}</span>
            <span className="text-xs text-slate-500">{LIBELLES[rule.type] ?? 'règle personnalisée'}</span>
          </div>

          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {Object.entries(rule.params)
              .filter(([cle]) => cle !== 'monitoredServiceId')
              .map(([cle, valeur]) => (
                <div key={cle} className="flex gap-1">
                  <dt>{cle} :</dt>
                  <dd className="font-mono text-slate-700">
                    {typeof valeur === 'object' ? JSON.stringify(valeur) : String(valeur)}
                  </dd>
                </div>
              ))}
            <div className="flex gap-1">
              <dt>cooldown :</dt>
              <dd className="font-mono text-slate-700">{rule.cooldown}</dd>
            </div>
          </dl>

          {/* Évaluation à blanc : aucun AlertEvent créé, personne n'est notifié
              (docs/ALERTING.md §6). Sert à valider un seuil avant de l'activer. */}
          {resultat && (
            <div
              className={`mt-2 rounded border px-2.5 py-1.5 text-xs ${
                resultat.triggered ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800'
              }`}
            >
              <span className="font-medium">{resultat.triggered ? 'Se déclencherait' : 'Ne se déclencherait pas'}</span>
              {' — '}
              {resultat.message}
            </div>
          )}
        </div>

        {admin && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onTester}
              disabled={enCours}
              className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              title="Évalue la règle immédiatement, sans créer d’alerte ni notifier"
            >
              {enCours ? 'Test…' : 'Tester'}
            </button>
            {onSupprimer && (
              <button type="button" onClick={onSupprimer} className="text-xs text-slate-500 hover:text-red-700">
                Supprimer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
