'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type TwoFactorSetup, type TwoFactorStatus } from '@sentinel/shared-types';

import { api } from '@/lib/api-client';
import { useSession } from '@/components/session-provider';

/**
 * Mon compte — et surtout, la double authentification (docs/AUTH.md).
 *
 * L'appairage se fait en deux temps : on montre le QR code, puis on demande un
 * premier code. Tant que ce code n'a pas été validé, rien n'est activé. Sans
 * cette confirmation, quelqu'un qui scanne mal son QR se retrouverait enfermé
 * dehors à sa prochaine connexion.
 */
export default function PageCompte() {
  const { user, rafraichir } = useSession();

  const [etat, setEtat] = useState<TwoFactorStatus | null>(null);
  const [appairage, setAppairage] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [codesDeRecuperation, setCodesDeRecuperation] = useState<string[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    try {
      setEtat(await api.twoFactor.status());
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const agir = async (action: () => Promise<void>) => {
    setErreur(null);
    setMessage(null);
    setEnCours(true);
    try {
      await action();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Action impossible');
    } finally {
      setEnCours(false);
    }
  };

  const commencerAppairage = () =>
    agir(async () => {
      setCodesDeRecuperation(null);
      setAppairage(await api.twoFactor.setup());
      setCode('');
    });

  const confirmer = (evenement: React.FormEvent) => {
    evenement.preventDefault();
    return agir(async () => {
      const { codes } = await api.twoFactor.confirm(code.trim());
      setCodesDeRecuperation(codes);
      setAppairage(null);
      setCode('');
      setMessage('La double authentification est active.');
      await charger();
      // La session restreinte à l'appairage cesse de l'être : on recharge
      // l'utilisateur pour que la navigation réapparaisse sans reconnexion.
      await rafraichir();
    });
  };

  const regenerer = () =>
    agir(async () => {
      const { codes } = await api.twoFactor.regenerateRecoveryCodes();
      setCodesDeRecuperation(codes);
      setMessage('Nouveaux codes générés. Les précédents ne fonctionnent plus.');
      await charger();
    });

  const desactiver = () =>
    agir(async () => {
      if (!confirm('Désactiver la double authentification sur votre compte ?')) return;
      await api.twoFactor.disable();
      setCodesDeRecuperation(null);
      setMessage('La double authentification est désactivée.');
      await charger();
    });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mon compte</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.displayName} — {ROLE_LABELS[user.role]}
        </p>
      </div>

      {user.mustEnrollTwoFactor && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <strong>La double authentification est obligatoire.</strong> Tant qu’elle n’est pas configurée, votre session
          ne donne accès à rien d’autre que cette page.
        </p>
      )}

      {erreur && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erreur}
        </p>
      )}
      {message && (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      )}

      <section className="space-y-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Double authentification</h2>
          {etat && (
            <span
              className={
                etat.enabled
                  ? 'rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700'
                  : 'rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500'
              }
            >
              {etat.enabled ? 'active' : 'inactive'}
            </span>
          )}
        </div>

        <p className="text-sm text-slate-600">
          Un code à six chiffres, renouvelé toutes les trente secondes par une application d’authentification
          (Google Authenticator, Authy, FreeOTP). Il s’ajoute au mot de passe : le connaître ne suffit plus à entrer.
        </p>

        {etat === null ? (
          <p className="text-sm text-slate-500">Chargement…</p>
        ) : appairage ? (
          <form onSubmit={confirmer} className="space-y-4 rounded border border-slate-200 p-4">
            <div>
              <h3 className="text-sm font-medium">1. Scannez ce code</h3>
              <p className="mt-1 text-xs text-slate-500">
                Dans votre application d’authentification : « ajouter un compte », puis scanner.
              </p>
            </div>

            {/* Image plutôt que balisage injecté : le serveur envoie un data URI,
                jamais du SVG à insérer dans la page. */}
            <img
              src={appairage.qrCode}
              alt="QR code d’appairage"
              className="h-48 w-48 rounded border border-slate-200 bg-white p-2"
            />

            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Impossible de scanner ? Saisir la clé à la main</summary>
              <code className="mt-2 block break-all rounded bg-slate-100 px-2 py-1.5 font-mono text-slate-700">
                {appairage.secret}
              </code>
            </details>

            <div>
              <h3 className="mb-1 text-sm font-medium">2. Saisissez le code affiché</h3>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                required
                className="w-40 rounded border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={enCours || code.trim().length < 6}
                className="rounded bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:bg-slate-300"
              >
                {enCours ? 'Vérification…' : 'Activer'}
              </button>
              <button
                type="button"
                onClick={() => setAppairage(null)}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
              >
                Annuler
              </button>
            </div>
          </form>
        ) : etat.enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {etat.recoveryCodesRemaining} code(s) de récupération encore utilisable(s).
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={regenerer}
                disabled={enCours}
                className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Régénérer les codes de récupération
              </button>
              <button
                type="button"
                onClick={desactiver}
                disabled={enCours || etat.enforced}
                title={etat.enforced ? 'La double authentification est imposée à tous les comptes.' : undefined}
                className="rounded border border-red-200 px-3 py-2 text-sm text-red-700 transition hover:bg-red-50 disabled:opacity-40"
              >
                Désactiver
              </button>
            </div>
            {etat.enforced && (
              <p className="text-xs text-slate-500">
                Elle est imposée à tous les comptes par un administrateur : elle ne peut pas être désactivée ici.
              </p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={commencerAppairage}
            disabled={enCours}
            className="rounded bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:bg-slate-300"
          >
            {enCours ? 'Préparation…' : 'Activer la double authentification'}
          </button>
        )}
      </section>

      {codesDeRecuperation && (
        <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-medium text-amber-900">Codes de récupération</h2>
          <p className="text-sm text-amber-900">
            <strong>Ils ne seront plus jamais affichés.</strong> Imprimez-les ou rangez-les dans votre gestionnaire de
            mots de passe. Chacun ne sert qu’une fois, et permet d’entrer si votre téléphone est perdu ou inaccessible.
          </p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-amber-900 sm:grid-cols-3">
            {codesDeRecuperation.map((c) => (
              <li key={c} className="rounded border border-amber-300 bg-white px-2 py-1 text-center">
                {c}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setCodesDeRecuperation(null)}
            className="rounded border border-amber-400 px-3 py-1.5 text-sm text-amber-900 transition hover:bg-amber-100"
          >
            Je les ai notés
          </button>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-surface-raised p-4">
        <h2 className="font-medium">Votre rôle</h2>
        <p className="mt-1 text-sm text-slate-600">{ROLE_DESCRIPTIONS[user.role]}</p>
        <p className="mt-2 text-xs text-slate-500">
          Votre mot de passe est celui de votre compte Windows : il se change dans l’Active Directory, pas ici.
          Sentinel n’en conserve aucune trace.
        </p>
      </section>
    </div>
  );
}
