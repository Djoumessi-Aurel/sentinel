'use client';

import type { RolePermissions } from '@sentinel/shared-types';

import { usePeut } from '@/components/session-provider';

/**
 * Masque ce que l'utilisateur n'a pas le droit de faire (docs/AUTH.md §7).
 *
 * **Ce n'est pas une protection.** Le backend refuse ces routes quel que soit
 * l'affichage, et c'est lui qui fait foi. Masquer évite seulement de proposer
 * un bouton dont la seule issue serait un message d'erreur.
 *
 * Le garde porte sur un **droit**, pas sur un rôle : ajouter un rôle ne doit pas
 * obliger à repasser sur tous les écrans.
 */
export function SiAutorise({
  droit,
  children,
  sinon = null,
}: {
  droit: keyof RolePermissions;
  children: React.ReactNode;
  sinon?: React.ReactNode;
}) {
  return usePeut(droit) ? <>{children}</> : <>{sinon}</>;
}

const REFUS = (
  <div className="rounded-lg border border-slate-200 bg-surface-raised p-4 text-sm text-slate-600">
    Vous n’avez pas les droits nécessaires pour cet écran.
  </div>
);

/** Écran entier soumis à un droit. */
export function PageSoumiseA({ droit, children }: { droit: keyof RolePermissions; children: React.ReactNode }) {
  return (
    <SiAutorise droit={droit} sinon={REFUS}>
      {children}
    </SiAutorise>
  );
}

/** Écran entier réservé à l'administration. */
export function AdminPage({ children }: { children: React.ReactNode }) {
  return <PageSoumiseA droit="administrer">{children}</PageSoumiseA>;
}

/** Bloc réservé à l'administration. */
export function AdminOnly({ children, sinon = null }: { children: React.ReactNode; sinon?: React.ReactNode }) {
  return (
    <SiAutorise droit="administrer" sinon={sinon}>
      {children}
    </SiAutorise>
  );
}
