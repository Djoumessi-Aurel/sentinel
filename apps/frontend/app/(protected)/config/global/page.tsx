'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { KNOWN_LOG_LEVELS, type GlobalConfig } from '@sentinel/shared-types';

import { ApiError, api } from '@/lib/api-client';

/**
 * Configuration globale (docs/CONFIG_MANAGEMENT.md §4).
 *
 * Point produit essentiel, rappelé à l'écran : enregistrer ici **ne change rien**
 * aux applications existantes. La propagation est un geste explicite, via
 * « Généraliser ». Sans ce rappel, l'utilisateur croirait avoir modifié tout le
 * parc et découvrirait le contraire lors d'un incident.
 */
export default function GlobalConfigPage() {
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [purge, setPurge] = useState<string | null>(null);

  useEffect(() => {
    void api.config
      .getGlobal()
      .then(setConfig)
      .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : 'Chargement impossible'));
  }, []);

  if (error) return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!config) return <p className="text-sm text-slate-500">Chargement…</p>;

  const setColor = (key: 'background' | 'text', value: string) =>
    setConfig({ ...config, displayColors: { ...config.displayColors, [key]: value } });

  const setLevelColor = (level: string, value: string) =>
    setConfig({
      ...config,
      displayColors: { ...config.displayColors, levelColors: { ...config.displayColors.levelColors, [level]: value } },
    });

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.config.updateGlobal({
        displayColors: config.displayColors,
        alertChannelsDefault: config.alertChannelsDefault,
        serviceCheckDefaults: config.serviceCheckDefaults,
        retention: config.retention,
      });
      setConfig(updated);
      setMessage('Configuration globale enregistrée. Les applications existantes sont inchangées.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  const purgerMaintenant = async () => {
    setPurge('en cours');
    try {
      const { report } = await api.retention.purge();
      setPurge(
        report
          ? `Purge effectuée : ${report.logs} log(s), ${report.resolvedAlerts} alerte(s) résolue(s), ${report.serviceEvents} transition(s) supprimée(s).`
          : 'Une purge est déjà en cours.',
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Purge impossible');
      setPurge(null);
    }
  };

  const contrast = contrastRatio(config.displayColors.text, config.displayColors.background);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Configuration globale</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ces valeurs servent de modèle aux <strong className="text-slate-600">nouvelles</strong> applications. Pour les
          appliquer aux applications déjà déclarées, utiliser{' '}
          <Link href="/config/generalize" className="text-sky-700 hover:text-sky-900">
            Généraliser
          </Link>
          .
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <h2 className="font-medium">Affichage des logs</h2>

        <div className="flex flex-wrap gap-4">
          <ColorField label="Fond" value={config.displayColors.background} onChange={(v) => setColor('background', v)} />
          <ColorField label="Texte" value={config.displayColors.text} onChange={(v) => setColor('text', v)} />
        </div>

        {/* Avertissement, pas blocage (docs/FRONTEND.md §5) : c'est un choix de
            l'utilisateur, mais une combinaison illisible se paie pendant un incident. */}
        {contrast < 4.5 && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Contraste texte/fond de {contrast.toFixed(1)}:1, sous le seuil WCAG AA de 4,5:1. Les logs risquent d’être
            difficiles à lire.
          </p>
        )}

        <div>
          <h3 className="mb-2 text-sm text-slate-600">Couleur par niveau</h3>
          <div className="flex flex-wrap gap-3">
            {[...new Set([...KNOWN_LOG_LEVELS, ...Object.keys(config.displayColors.levelColors)])].map((level) => (
              <ColorField
                key={level}
                label={level}
                value={config.displayColors.levelColors[level] ?? config.displayColors.text}
                onChange={(value) => setLevelColor(level, value)}
              />
            ))}
          </div>
        </div>

        <div
          className="rounded border border-slate-200 p-3 font-mono text-xs"
          style={{ backgroundColor: config.displayColors.background, color: config.displayColors.text }}
        >
          <div>
            <span style={{ color: config.displayColors.levelColors['INFO'] }}>INFO </span> Traitement de début de journée
            démarré
          </div>
          <div>
            <span style={{ color: config.displayColors.levelColors['WARN'] }}>WARN </span> Reprise de la connexion JDBC
          </div>
          <div>
            <span style={{ color: config.displayColors.levelColors['ERROR'] }}>ERROR</span> Timeout JDBC après 30 s
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <h2 className="font-medium">Canaux d’alerte par défaut</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {(['visual', 'sound', 'email', 'sms'] as const).map((channel) => (
            <label key={channel} className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={config.alertChannelsDefault[channel]}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    alertChannelsDefault: { ...config.alertChannelsDefault, [channel]: event.target.checked },
                  })
                }
              />
              {{ visual: 'Visuel', sound: 'Sonore', email: 'Email', sms: 'SMS' }[channel]}
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Les destinataires email et SMS se renseignent application par application : un canal activé sans destinataire
          n’envoie rien, et l’historique des alertes le signale explicitement.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <h2 className="font-medium">Vérification des services</h2>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label>
            <span className="mb-1 block text-slate-600">Intervalle par défaut (secondes)</span>
            <input
              type="number"
              min={5}
              max={3600}
              value={config.serviceCheckDefaults.checkInterval}
              onChange={(event) =>
                setConfig({
                  ...config,
                  serviceCheckDefaults: {
                    ...config.serviceCheckDefaults,
                    checkInterval: Number(event.target.value),
                  },
                })
              }
              className="w-28 rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
            />
          </label>
          <label className="flex items-center gap-2 pb-1.5 text-slate-700">
            <input
              type="checkbox"
              checked={config.serviceCheckDefaults.criticalByDefault}
              onChange={(event) =>
                setConfig({
                  ...config,
                  serviceCheckDefaults: { ...config.serviceCheckDefaults, criticalByDefault: event.target.checked },
                })
              }
            />
            Nouveau service critique par défaut
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <div>
          <h2 className="font-medium">Rétention des données</h2>
          <p className="mt-1 text-xs text-slate-500">
            Purge automatique chaque nuit à 3 h. Trois durées distinctes : les logs sont volumineux et perdent vite leur
            intérêt, l’historique des alertes sert au bilan, les transitions de service racontent la fiabilité sur la
            durée. Les alertes <strong>encore actives</strong> ne sont jamais purgées, quel que soit leur âge.
          </p>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <ChampJours
            label="Logs"
            value={config.retention.logsDays}
            onChange={(logsDays) => setConfig({ ...config, retention: { ...config.retention, logsDays } })}
          />
          <ChampJours
            label="Alertes résolues"
            value={config.retention.resolvedAlertsDays}
            onChange={(resolvedAlertsDays) =>
              setConfig({ ...config, retention: { ...config.retention, resolvedAlertsDays } })
            }
          />
          <ChampJours
            label="Transitions de service"
            value={config.retention.serviceEventsDays}
            onChange={(serviceEventsDays) =>
              setConfig({ ...config, retention: { ...config.retention, serviceEventsDays } })
            }
          />
          <button
            type="button"
            onClick={() => void purgerMaintenant()}
            disabled={purge !== null}
            className="self-end rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            title="Applique la rétention immédiatement, sans attendre le passage de la nuit"
          >
            {purge === 'en cours' ? 'Purge…' : 'Purger maintenant'}
          </button>
        </div>
        {purge && purge !== 'en cours' && <p className="text-xs text-emerald-700">{purge}</p>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-surface-raised p-4">
        <h2 className="mb-2 font-medium">Analyseurs créés pour toute nouvelle application</h2>
        <ul className="space-y-1 text-sm text-slate-600">
          {config.analyzerDefaults.map((analyzer) => (
            <li key={analyzer.type} className="flex gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{analyzer.type}</span>
              {analyzer.name}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {message && <span className="text-sm text-emerald-600">{message}</span>}
      </div>
    </div>
  );
}

function ChampJours({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      <span className="mb-1 block text-slate-600">{label} (jours)</span>
      <input
        type="number"
        min={1}
        max={3650}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-28 rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-slate-600">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-transparent"
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 rounded border border-slate-200 bg-surface px-2 py-1 font-mono text-xs text-slate-700"
        />
      </span>
    </label>
  );
}

/** Ratio de contraste WCAG, calculé côté client (docs/FRONTEND.md §5). */
function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const normalized = hex.replace('#', '');
    const full = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
    const channels = [0, 2, 4].map((offset) => {
      const value = parseInt(full.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
  };

  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
