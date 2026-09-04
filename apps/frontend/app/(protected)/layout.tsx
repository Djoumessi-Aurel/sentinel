import Link from 'next/link';

import { AlertCenter } from '@/components/alert-center';

/**
 * Layout unique de toutes les pages applicatives (docs/AUTH.md §1).
 *
 * En Phase 1-3 il ne vérifie rien : son rôle est de **centraliser dès
 * maintenant** le point où le contrôle de session s'installera en Phase 4, pour
 * qu'aucune page n'ait alors à être reprise une par une.
 */
const NAV = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/applications', label: 'Applications' },
  { href: '/alerts', label: 'Alertes' },
  { href: '/config/global', label: 'Configuration' },
  { href: '/config/generalize', label: 'Généraliser' },
];

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-surface-raised">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded bg-sky-100 text-sm font-bold text-sky-700">S</span>
            <span className="font-semibold tracking-tight">Sentinel</span>
            <span className="hidden text-xs text-slate-500 sm:inline">supervision monétique — GIE GCB</span>
          </Link>

          <nav className="ml-auto flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-3 py-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/*
        Rappel permanent tant que la Phase 4 n'est pas livrée : l'application
        n'a aucune authentification et ne doit pas être exposée hors du réseau
        interne (docs/SECURITY.md A07). Un bandeau discret vaut mieux qu'une
        note dans un document que personne ne relit avant la mise en service.
      */}
      <div className="border-b border-amber-200 bg-amber-50 px-6 py-1.5 text-center text-xs text-amber-800">
        Authentification non encore implémentée (Phase 4) — à réserver au réseau interne.
      </div>

      {/*
        Monté ici, et non dans une page : une alerte doit être vue et entendue
        quel que soit l'écran affiché — tableau de bord, historique, ou
        télévision d'open space.
      */}
      <AlertCenter />

      <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
    </div>
  );
}
