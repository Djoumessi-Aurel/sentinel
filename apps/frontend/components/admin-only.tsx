'use client';

import { useIsAdmin } from '@/components/session-provider';

/**
 * Masque ce qu'un lecteur ne peut pas faire (docs/AUTH.md §7).
 *
 * **Ce n'est pas une protection.** Le backend refuse ces routes quel que soit
 * l'affichage, et c'est lui qui fait foi. Masquer évite seulement de proposer
 * un bouton dont la seule issue serait un message d'erreur.
 */
export function AdminOnly({ children, sinon = null }: { children: React.ReactNode; sinon?: React.ReactNode }) {
  return useIsAdmin() ? <>{children}</> : <>{sinon}</>;
}

/** Écran entier réservé aux administrateurs. */
export function AdminPage({ children }: { children: React.ReactNode }) {
  return (
    <AdminOnly
      sinon={
        <div className="rounded-lg border border-slate-200 bg-surface-raised p-4 text-sm text-slate-600">
          Cet écran est réservé aux administrateurs.
        </div>
      }
    >
      {children}
    </AdminOnly>
  );
}
