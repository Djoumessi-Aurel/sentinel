'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { peut, type CurrentUser, type RolePermissions } from '@sentinel/shared-types';

import { SESSION_EXPIRED_EVENT, api } from '@/lib/api-client';

/**
 * Session côté interface (docs/AUTH.md §6).
 *
 * **Ce n'est pas un contrôle de sécurité.** Le contrôle est fait par le backend,
 * sur chaque requête, et lui seul fait foi. Ce qui suit sert à ne pas afficher
 * un écran vide à quelqu'un qui n'est pas connecté, et à masquer les boutons
 * qu'un lecteur ne peut de toute façon pas actionner : cacher une action qui
 * échouerait vaut mieux que la proposer pour renvoyer une erreur.
 */
interface SessionContexte {
  user: CurrentUser;
  /** Recharge l'utilisateur — après un changement de rôle, par exemple. */
  rafraichir: () => Promise<void>;
}

const Contexte = createContext<SessionContexte | null>(null);

/** Utilisateur connecté. Ne s'appelle que sous `SessionProvider`. */
export function useSession(): SessionContexte {
  const valeur = useContext(Contexte);
  if (!valeur) throw new Error('useSession doit être utilisé dans SessionProvider');
  return valeur;
}

/**
 * Droits de l'utilisateur connecté : `usePeut('resoudreLesAlertes')`.
 *
 * On interroge un **droit**, jamais un rôle. Comparer à `role === 'admin'` un
 * peu partout obligerait à repasser sur chaque écran le jour où un rôle
 * s'ajoute — ce qui est précisément arrivé avec « superviseur ».
 */
export function usePeut(droit: keyof RolePermissions): boolean {
  return peut(useSession().user.role, droit);
}

/** Raccourci de lisibilité : `const admin = useIsAdmin()`. */
export function useIsAdmin(): boolean {
  return useSession().user.role === 'admin';
}

type Etat = { statut: 'chargement' } | { statut: 'connecte'; user: CurrentUser } | { statut: 'anonyme' };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [etat, setEtat] = useState<Etat>({ statut: 'chargement' });

  const charger = useCallback(async () => {
    try {
      setEtat({ statut: 'connecte', user: await api.auth.me() });
    } catch {
      setEtat({ statut: 'anonyme' });
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  // Session expirée en cours de route : le signal vient du client HTTP, quelle
  // que soit la requête qui a reçu le 401.
  useEffect(() => {
    const surExpiration = () => setEtat({ statut: 'anonyme' });
    window.addEventListener(SESSION_EXPIRED_EVENT, surExpiration);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, surExpiration);
  }, []);

  // Session restreinte à l'appairage : le backend refuse déjà tout le reste,
  // mais laisser l'utilisateur se heurter à des 403 sur chaque écran serait
  // incompréhensible. On l'amène là où il peut agir.
  useEffect(() => {
    if (etat.statut !== 'connecte') return;
    if (!etat.user.mustEnrollTwoFactor) return;
    if (pathname === '/compte') return;
    router.replace('/compte');
  }, [etat, pathname, router]);

  useEffect(() => {
    if (etat.statut !== 'anonyme') return;
    // On retient la page demandée pour y revenir après la connexion : atterrir
    // systématiquement sur le tableau de bord ferait perdre le lien qu'on
    // venait d'ouvrir.
    const destination = pathname && pathname !== '/' ? `?suite=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${destination}`);
  }, [etat.statut, pathname, router]);

  if (etat.statut !== 'connecte') {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-slate-500">
        {etat.statut === 'chargement' ? 'Vérification de la session…' : 'Redirection vers la connexion…'}
      </div>
    );
  }

  return <Contexte.Provider value={{ user: etat.user, rafraichir: charger }}>{children}</Contexte.Provider>;
}
