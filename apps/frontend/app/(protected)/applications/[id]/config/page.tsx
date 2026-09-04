'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  KNOWN_LOG_LEVELS,
  type AlertChannelName,
  type AlertChannels,
  type AppConfig,
  type Application,
  type GlobalConfig,
  type QuietHours,
} from '@sentinel/shared-types';

import { ApiError, api } from '@/lib/api-client';

/**
 * Configuration d'une application (docs/FRONTEND.md §5).
 *
 * C'est ici qu'on décide quels canaux d'alerte sont actifs pour cette
 * application — en particulier le canal **sonore**, qui conditionne le
 * déclenchement de la sirène. Sans cet écran, le réglage n'existait qu'en base
 * et n'était modifiable par personne.
 */

const CHANNEL_LABELS: Record<AlertChannelName, string> = {
  visual: 'Visuel (bandeau)',
  sound: 'Sonore (sirène)',
  email: 'Email',
  sms: 'SMS',
};

const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: true,
  start: '20:00',
  end: '07:00',
  mutedChannels: ['sound', 'sms'],
};

export default function ApplicationConfigPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id ?? '';

  const [application, setApplication] = useState<Application | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [smsInput, setSmsInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<AlertChannelName | null>(null);

  const load = useCallback(async () => {
    if (!applicationId) return;
    try {
      const [app, appConfig, global] = await Promise.all([
        api.applications.get(applicationId),
        api.config.getApp(applicationId),
        api.config.getGlobal(),
      ]);
      setApplication(app);
      setConfig(appConfig);
      setGlobalConfig(global);
      setEmailInput(appConfig.alertChannels.email.recipients.join(', '));
      setSmsInput(appConfig.alertChannels.sms.recipients.join(', '));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Chargement impossible');
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !config) {
    return <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!config || !application) return <p className="text-sm text-slate-500">Chargement…</p>;

  const setChannels = (channels: AlertChannels) => setConfig({ ...config, alertChannels: channels });

  /** Découpe une saisie « a@b.fr, c@d.fr » en liste, sans entrée vide. */
  const parseList = (value: string): string[] =>
    value
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter((item) => item !== '');

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const updated = await api.config.updateApp(applicationId, {
        displayColors: config.displayColors,
        alertChannels: {
          ...config.alertChannels,
          email: { ...config.alertChannels.email, recipients: parseList(emailInput) },
          sms: { ...config.alertChannels.sms, recipients: parseList(smsInput) },
        },
        quietHours: config.quietHours,
      });
      setConfig(updated);
      setEmailInput(updated.alertChannels.email.recipients.join(', '));
      setSmsInput(updated.alertChannels.sms.recipients.join(', '));
      setMessage('Configuration enregistrée.');
    } catch (cause) {
      const detail =
        cause instanceof ApiError && cause.details?.length
          ? `${cause.message} — ${cause.details.map((d) => `${d.path} : ${d.message}`).join(' ; ')}`
          : cause instanceof ApiError
            ? cause.message
            : 'Enregistrement impossible';
      setError(detail);
    } finally {
      setSaving(false);
    }
  };

  const testChannel = async (channel: AlertChannelName) => {
    setTesting(channel);
    setMessage(null);
    setError(null);
    try {
      const outcome = await api.alerts.testChannel(applicationId, channel);
      setMessage(
        `Test ${CHANNEL_LABELS[channel]} : ${outcome.status === 'sent' ? 'envoyé' : outcome.status === 'skipped' ? 'ignoré' : 'échec'}${
          outcome.detail ? ` — ${outcome.detail}` : ''
        }`,
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Test impossible');
    } finally {
      setTesting(null);
    }
  };

  const differentDuGlobal =
    globalConfig !== null &&
    JSON.stringify(config.displayColors) !== JSON.stringify(globalConfig.displayColors);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/applications/${applicationId}/live`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {application.name}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Configuration</h1>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>
      )}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <div>
          <h2 className="font-medium">Canaux d’alerte</h2>
          <p className="mt-1 text-xs text-slate-500">
            La sirène ne se déclenche que si le canal sonore est activé ici. Un canal actif sans destinataire n’envoie
            rien : l’historique des alertes le signale explicitement.
          </p>
        </div>

        <div className="space-y-3">
          {(['visual', 'sound', 'email', 'sms'] as const).map((channel) => {
            const actif =
              channel === 'email'
                ? config.alertChannels.email.enabled
                : channel === 'sms'
                  ? config.alertChannels.sms.enabled
                  : config.alertChannels[channel];

            return (
              <div key={channel} className="flex flex-wrap items-center gap-3">
                <label className="flex w-52 items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={actif}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      if (channel === 'email') {
                        setChannels({ ...config.alertChannels, email: { ...config.alertChannels.email, enabled: checked } });
                      } else if (channel === 'sms') {
                        setChannels({ ...config.alertChannels, sms: { ...config.alertChannels.sms, enabled: checked } });
                      } else {
                        setChannels({ ...config.alertChannels, [channel]: checked });
                      }
                    }}
                  />
                  {CHANNEL_LABELS[channel]}
                </label>

                {channel === 'email' && (
                  <input
                    value={emailInput}
                    onChange={(event) => setEmailInput(event.target.value)}
                    placeholder="operateur@gie.local, superviseur@gie.local"
                    className="min-w-[280px] flex-1 rounded border border-slate-200 bg-surface px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400"
                  />
                )}
                {channel === 'sms' && (
                  <input
                    value={smsInput}
                    onChange={(event) => setSmsInput(event.target.value)}
                    placeholder="+237690000000, +237699999999"
                    className="min-w-[280px] flex-1 rounded border border-slate-200 bg-surface px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400"
                  />
                )}

                <button
                  type="button"
                  onClick={() => void testChannel(channel)}
                  disabled={testing !== null}
                  className="ml-auto rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  {testing === channel ? 'Test…' : 'Tester'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <div>
          <h2 className="font-medium">Heures creuses</h2>
          <p className="mt-1 text-xs text-slate-500">
            Pendant cette plage, les canaux cochés se taisent. La détection continue et les alertes restent visibles dans
            l’historique : seule la notification est filtrée.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={config.quietHours?.enabled ?? false}
            onChange={(event) =>
              setConfig({
                ...config,
                quietHours: event.target.checked
                  ? { ...(config.quietHours ?? DEFAULT_QUIET_HOURS), enabled: true }
                  : null,
              })
            }
          />
          Activer les heures creuses
        </label>

        {config.quietHours && (
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label>
              <span className="mb-1 block text-slate-600">De</span>
              <input
                type="time"
                value={config.quietHours.start}
                onChange={(event) =>
                  setConfig({ ...config, quietHours: { ...config.quietHours!, start: event.target.value } })
                }
                className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
              />
            </label>
            <label>
              <span className="mb-1 block text-slate-600">À</span>
              <input
                type="time"
                value={config.quietHours.end}
                onChange={(event) =>
                  setConfig({ ...config, quietHours: { ...config.quietHours!, end: event.target.value } })
                }
                className="rounded border border-slate-200 bg-surface px-3 py-1.5 text-slate-800"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              {(['visual', 'sound', 'email', 'sms'] as const).map((channel) => (
                <label key={channel} className="flex items-center gap-1.5 text-slate-700">
                  <input
                    type="checkbox"
                    checked={config.quietHours!.mutedChannels.includes(channel)}
                    onChange={(event) => {
                      const muted = new Set(config.quietHours!.mutedChannels);
                      if (event.target.checked) muted.add(channel);
                      else muted.delete(channel);
                      setConfig({ ...config, quietHours: { ...config.quietHours!, mutedChannels: [...muted] } });
                    }}
                  />
                  {channel}
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Affichage des logs</h2>
            <p className="mt-1 text-xs text-slate-500">Propre à cette application.</p>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              differentDuGlobal ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {differentDuGlobal ? 'différent de la configuration globale' : 'aligné sur la configuration globale'}
          </span>
        </div>

        <div className="flex flex-wrap gap-4">
          <ColorField
            label="Fond"
            value={config.displayColors.background}
            onChange={(value) =>
              setConfig({ ...config, displayColors: { ...config.displayColors, background: value } })
            }
          />
          <ColorField
            label="Texte"
            value={config.displayColors.text}
            onChange={(value) => setConfig({ ...config, displayColors: { ...config.displayColors, text: value } })}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          {[...new Set([...KNOWN_LOG_LEVELS, ...Object.keys(config.displayColors.levelColors)])].map((level) => (
            <ColorField
              key={level}
              label={level}
              value={config.displayColors.levelColors[level] ?? config.displayColors.text}
              onChange={(value) =>
                setConfig({
                  ...config,
                  displayColors: {
                    ...config.displayColors,
                    levelColors: { ...config.displayColors.levelColors, [level]: value },
                  },
                })
              }
            />
          ))}
        </div>
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
        <Link href="/config/generalize" className="text-sm text-slate-500 hover:text-slate-700">
          Réaligner sur la configuration globale
        </Link>
      </div>
    </div>
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
