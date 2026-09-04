'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { ROLE_LABELS } from '@sentinel/shared-types';

import { api } from '@/lib/api-client';
import { usePeut, useSession } from '@/components/session-provider';

const NAV_COMMUNE = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/applications', label: 'Applications' },
  { href: '/alerts', label: 'Alertes' },
];

const NAV_ADMINISTRATION = [
  { href: '/config/global', label: 'Configuration' },
  { href: '/config/generalize', label: 'Généraliser' },
];

const NAV_UTILISATEURS = [{ href: '/users', label: 'Utilisateurs' }];

/**
 * Barre de navigation.
 *
 * Les entrées qu'un utilisateur n'a pas le droit d'ouvrir lui sont masquées.
 * C'est du confort, pas une protection : le backend refuse ces routes de toute
 * façon (docs/AUTH.md §7). Proposer un lien qui ne mène qu'à une erreur serait
 * simplement désagréable.
 */
export function AppHeader() {
  const { user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);

  // Chaque bloc de navigation suit le droit qui commande l'écran auquel il mène,
  // et non un rôle nommé : les deux resteront cohérents même si les droits
  // d'un rôle changent.
  const administrateur = usePeut('administrer');
  const gestionnaire = usePeut('gererLesUtilisateurs');

  // Session restreinte à l'appairage : proposer une navigation qui ne mène qu'à
  // des refus n'aiderait personne.
  const entrees = user.mustEnrollTwoFactor
    ? []
    : [
        ...NAV_COMMUNE,
        ...(administrateur ? NAV_ADMINISTRATION : []),
        ...(gestionnaire ? NAV_UTILISATEURS : []),
      ];

  const seDeconnecter = async () => {
    setDeconnexionEnCours(true);
    try {
      await api.auth.logout();
    } catch {
      // Le cookie a peut-être déjà expiré : on renvoie vers la connexion dans
      // tous les cas, c'est ce que l'utilisateur a demandé.
    }
    router.replace('/login');
  };

  return (
    <header className="border-b border-slate-200 bg-surface-raised">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded bg-sky-100 text-sm font-bold text-sky-700">S</span>
          <span className="font-semibold tracking-tight">Sentinel</span>
          <span className="hidden text-xs text-slate-500 sm:inline">supervision monétique — GIE GCB</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 text-sm">
          {entrees.map((item) => {
            const actif = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={actif ? 'page' : undefined}
                className={
                  actif
                    ? 'rounded bg-slate-100 px-3 py-1.5 font-medium text-slate-900'
                    : 'rounded px-3 py-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 border-l border-slate-200 pl-4 text-sm">
          <Link href="/compte" className="text-slate-700 transition hover:text-slate-900">
            {user.displayName}
            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              {ROLE_LABELS[user.role]}
            </span>
          </Link>
          <button
            type="button"
            onClick={seDeconnecter}
            disabled={deconnexionEnCours}
            className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {deconnexionEnCours ? '…' : 'Se déconnecter'}
          </button>
        </div>
      </div>
    </header>
  );
}
