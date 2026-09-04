'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isChannelNotified, type AlertNewEvent } from '@sentinel/shared-types';

import { getSiren, type SirenState } from '@/lib/alert-siren';
import { useGlobalAlerts } from '@/lib/socket-client';

/**
 * Centre d'alertes global, monté une seule fois dans le layout.
 *
 * Il écoute les alertes de **tout le parc**, sur toutes les pages : une alerte
 * doit être vue et entendue depuis le tableau de bord, la liste des alertes ou
 * la télévision de l'open space, pas seulement depuis la page temps réel de
 * l'application concernée.
 *
 * Le son est **actif par défaut**, sans étape de consentement : qui ne veut pas
 * l'entendre coupe l'onglet dans son navigateur. Reste que la politique de
 * lecture automatique est appliquée par le navigateur et non par ce code —
 * aucune autorisation ne peut être accordée depuis le JavaScript. On la contourne
 * de la seule manière possible : en débloquant le son au premier geste
 * quelconque de l'utilisateur, sans rien lui demander (`armOnFirstGesture`).
 */

/** Nombre d'alertes récentes gardées dans le bandeau. */
const RECENT_LIMIT = 4;

export function AlertCenter() {
  const [sirenState, setSirenState] = useState<SirenState>('blocked');
  const [recent, setRecent] = useState<AlertNewEvent[]>([]);
  const [ringing, setRinging] = useState(false);

  const ringingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const siren = getSiren();
    let detacher: (() => void) | undefined;
    let demonte = false;

    // Première tentative immédiate : elle réussit si le navigateur autorise déjà
    // le son pour ce site — c'est le cas d'un poste réglé une fois pour toutes,
    // typiquement l'écran de l'open space (voir docs/FRONTEND.md §3.1).
    void siren.unlock().then((state) => {
      if (demonte) return;
      setSirenState(state);
      // Sinon on s'arme sur le premier geste, sans rien demander à l'utilisateur.
      if (state !== 'ready') detacher = siren.armOnFirstGesture(setSirenState);
    });

    return () => {
      demonte = true;
      detacher?.();
    };
  }, []);

  const onAlert = useCallback((event: AlertNewEvent) => {
    setRecent((current) => [event, ...current.filter((item) => item.alert.id !== event.alert.id)].slice(0, RECENT_LIMIT));

    // La sirène ne sonne que pour les applications dont le canal sonore est
    // activé. On se fie au statut consigné par le backend au moment de l'alerte
    // plutôt que de relire la configuration : il porte déjà la décision
    // complète, heures creuses comprises (docs/ALERTING.md §2 et §4).
    if (!isChannelNotified(event.alert, 'sound')) return;
    if (!getSiren().play(event.alert.severity)) return;

    setRinging(true);
    if (ringingTimer.current) clearTimeout(ringingTimer.current);
    ringingTimer.current = setTimeout(() => setRinging(false), event.alert.severity === 'critical' ? 8000 : 2200);
  }, []);

  const { connected } = useGlobalAlerts(onAlert);

  useEffect(
    () => () => {
      if (ringingTimer.current) clearTimeout(ringingTimer.current);
    },
    [],
  );

  const silenceForce = sirenState === 'blocked';

  return (
    <>
      {/*
        Le son peut rester bloqué tant qu'aucune interaction n'a eu lieu. On ne
        demande rien — le premier clic suffira — mais on le signale, car une
        surveillance sonore qui échoue en silence est exactement ce que cette
        application est censée empêcher (docs/CLAUDE.md §5.4). L'indicateur est
        volontairement discret : ce n'est pas une action à mener, juste un état.
      */}
      {silenceForce && (
        <div className="border-b border-slate-200 bg-slate-100 px-6 py-1 text-center text-xs text-slate-500">
          Son en attente de la première interaction avec la page — un clic quelconque suffit à l’activer.
        </div>
      )}

      {/* Bandeau des alertes reçues en direct, visible sur toutes les pages. */}
      {recent.length > 0 && (
        <div className="border-b border-red-200 bg-red-50">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-1.5 px-6 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-red-700">Alertes en direct</span>

              {ringing && (
                <button
                  type="button"
                  onClick={() => {
                    getSiren().stop();
                    setRinging(false);
                  }}
                  className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
                >
                  Couper la sirène
                </button>
              )}

              <button type="button" onClick={() => setRecent([])} className="ml-auto text-xs text-red-600 hover:text-red-800">
                Masquer
              </button>
            </div>

            {recent.map((event) => (
              <Link
                key={event.alert.id}
                href={`/applications/${event.applicationId}/live`}
                className="flex items-start gap-2 text-sm text-red-900 hover:underline"
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                    event.alert.severity === 'critical' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
                  }`}
                >
                  {event.applicationName}
                </span>
                <span className="min-w-0 flex-1 truncate">{event.alert.message}</span>
                {!isChannelNotified(event.alert, 'sound') && (
                  <span
                    className="shrink-0 text-[11px] text-red-600"
                    title="Le canal sonore est désactivé pour cette application, ou nous sommes en heures creuses."
                  >
                    sans son
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Témoin : sans lui, rien ne distingue « aucune alerte » de « connexion perdue ». */}
      {!connected && (
        <div className="border-b border-amber-300 bg-amber-50 px-6 py-1 text-center text-xs text-amber-800">
          Flux temps réel déconnecté — les alertes ne parviendront pas tant que la connexion n’est pas rétablie.
        </div>
      )}
    </>
  );
}
