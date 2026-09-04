'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { AuthStatus } from '@sentinel/shared-types';

import { api } from '@/lib/api-client';

/**
 * Page de connexion — la seule hors du layout protégé (docs/AUTH.md).
 *
 * Le formulaire ne cherche pas à deviner pourquoi une connexion échoue : le
 * backend renvoie le même message pour un mot de passe faux, un compte inconnu
 * et un compte désactivé, et le reproduire tel quel est délibéré. Nuancer ici
 * indiquerait quels identifiants existent.
 */
function FormulaireConnexion() {
  const router = useRouter();
  const parametres = useSearchParams();
  const suite = parametres.get('suite') ?? '/dashboard';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [statut, setStatut] = useState<AuthStatus | null>(null);

  // L'état de l'authentification est public : il permet d'avertir avant toute
  // tentative que l'annuaire ne répond pas — sinon l'utilisateur croirait
  // s'être trompé de mot de passe.
  useEffect(() => {
    api.auth
      .status()
      .then(setStatut)
      .catch(() => setStatut(null));
  }, []);

  const soumettre = async (evenement: React.FormEvent) => {
    evenement.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await api.auth.login({ username: username.trim(), password });
      // `replace` et non `push` : le bouton « retour » ne doit pas ramener sur
      // le formulaire d'une session déjà ouverte.
      router.replace(suite);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Connexion impossible');
      setPassword('');
      setEnCours(false);
    }
  };

  const annuaireInjoignable = statut !== null && statut.mode === 'ldap' && !statut.directoryReachable;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded bg-sky-100 text-base font-bold text-sky-700">S</span>
          <div>
            <p className="font-semibold tracking-tight">Sentinel</p>
            <p className="text-xs text-slate-500">supervision monétique — GIE GCB</p>
          </div>
        </div>

        <form onSubmit={soumettre} className="space-y-4 rounded-lg border border-slate-200 bg-surface-raised p-5">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm text-slate-600">
              Identifiant
            </label>
            <input
              id="username"
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
            <p className="mt-1 text-xs text-slate-500">Votre compte Windows, sans le domaine.</p>
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-slate-600">
              Mot de passe
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />
          </div>

          {erreur && (
            <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {erreur}
            </p>
          )}

          <button
            type="submit"
            disabled={enCours || username.trim() === '' || password === ''}
            className="w-full rounded bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {enCours ? 'Connexion…' : 'Se connecter'}
          </button>

          <p className="text-center text-xs text-slate-500">
            L’accès demande un compte Active Directory <em>et</em> d’avoir été déclaré par un administrateur.
          </p>
        </form>

        {annuaireInjoignable && (
          <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            L’annuaire ne répond pas. Les connexions nominatives échoueront tant qu’il reste injoignable — ce n’est pas
            votre mot de passe.
          </p>
        )}

        {statut?.mode === 'dev' && (
          <p className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            <strong>Mode développement</strong> — le mot de passe n’est pas vérifié. Ne jamais utiliser en production.
          </p>
        )}
      </div>
    </main>
  );
}

export default function PageConnexion() {
  // `useSearchParams` impose une frontière de suspense au prérendu.
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-slate-500">Chargement…</div>}>
      <FormulaireConnexion />
    </Suspense>
  );
}
