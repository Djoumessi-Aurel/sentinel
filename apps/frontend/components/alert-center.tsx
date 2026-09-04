'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertNewEvent } from '@sentinel/shared-types';

import { getSiren, type SirenState } from '@/lib/alert-siren';
import { useGlobalAlerts } from '@/lib/socket-client';

/**
 * Centre d'alertes global, monté une seule fois dans le layout.
 *
 * Il écoute les alertes de **tout le parc**, sur toutes les pages. Avant, le son
 * n'était câblé que sur la page temps réel d'une application donnée : une alerte
 * sur « planning backoffice » restait donc muette pour quelqu'un qui regardait
 * le tableau de bord ou la liste des alertes — c'est-à-dire presque toujours.
 */

const SOUND_PREFERENCE_KEY = 'sentinel.sound.enabled';
/** Nombre d'alertes récentes gardées dans le bandeau. */
const RECENT_LIMIT = 4;

export function AlertCenter() {
  const [soundWanted, setSoundWanted] = useState(false);
  const [sirenState, setSirenState] = useState<SirenState>('blocked');
  const [recent, setRecent] = useState<AlertNewEvent[]>([]);
  const [ringing, setRinging] = useState(false);

  const ringingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Préférence relue au chargement : sur un écran mural, on ne veut pas
  // réactiver le son à chaque rafraîchissement de la page.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(SOUND_PREFERENCE_KEY) : null;
    if (stored !== 'true') {
      setSirenState(getSiren().state);
      return;
    }
    setSoundWanted(true);
    // La reprise automatique ne marche que si le navigateur a déjà mémorisé une
    // interaction sur ce site ; sinon l'état reste « bloqué » et le bandeau
    // invite explicitement à cliquer.
    void getSiren()
      .unlock()
      .then(setSirenState);
  }, []);

  const enableSound = useCallback(async () => {
    const state = await getSiren().unlock();
    setSirenState(state);
    if (state === 'ready') {
      setSoundWanted(true);
      window.localStorage.setItem(SOUND_PREFERENCE_KEY, 'true');
      // Retour immédiat : l'utilisateur doit entendre que ça marche, sinon il
      // ne saura qu'au premier incident si le son est vraiment actif.
      getSiren().play('warning');
    }
  }, []);

  const disableSound = useCallback(() => {
    getSiren().stop();
    setSoundWanted(false);
    setRinging(false);
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, 'false');
  }, []);

  const onAlert = useCallback(
    (event: AlertNewEvent) => {
      setRecent((current) => [event, ...current.filter((item) => item.alert.id !== event.alert.id)].slice(0, RECENT_LIMIT));

      if (!soundWanted) return;
      if (!getSiren().play(event.alert.severity)) return;

      setRinging(true);
      if (ringingTimer.current) clearTimeout(ringingTimer.current);
      ringingTimer.current = setTimeout(() => setRinging(false), event.alert.severity === 'critical' ? 8000 : 2200);
    },
    [soundWanted],
  );

  const { connected } = useGlobalAlerts(onAlert);

  useEffect(() => () => { if (ringingTimer.current) clearTimeout(ringingTimer.current); }, []);

  const soundActive = soundWanted && sirenState === 'ready';

  return (
    <>
      {/* Le son ne peut pas démarrer sans un geste : tant qu'il est inactif, on
          le dit franchement plutôt que de laisser croire que la surveillance
          sonore fonctionne. */}
      {!soundActive && sirenState !== 'unavailable' && (
        <div className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-center text-sm text-amber-900">
          Les alertes sonores sont désactivées.{' '}
          <button
            type="button"
            onClick={() => void enableSound()}
            className="rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-600"
          >
            Activer le son
          </button>{' '}
          <span className="text-amber-700">— nécessaire une fois par navigateur, y compris sur l’écran de l’open space.</span>
        </div>
      )}

      {/* Bandeau des alertes reçues en direct, visible sur toutes les pages. */}
      {recent.length > 0 && (
        <div className="border-b border-red-200 bg-red-50">
          <div className="mx-auto flex max-w-[1600px] flex-col gap-1.5 px-6 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-red-700">
                Alertes en direct
              </span>
              {soundActive && (
                <button
                  type="button"
                  onClick={ringing ? () => { getSiren().stop(); setRinging(false); } : disableSound}
                  className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-100"
                >
                  {ringing ? 'Couper la sirène' : 'Désactiver le son'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setRecent([])}
                className="ml-auto text-xs text-red-600 hover:text-red-800"
              >
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
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Témoin discret : sans lui, rien ne distingue « aucune alerte » de
          « connexion temps réel perdue ». */}
      {!connected && (
        <div className="border-b border-slate-200 bg-slate-100 px-6 py-1 text-center text-xs text-slate-500">
          Flux temps réel déconnecté — les alertes ne parviendront pas tant que la connexion n’est pas rétablie.
        </div>
      )}
    </>
  );
}
