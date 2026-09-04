import { AlertCenter } from '@/components/alert-center';
import { AppHeader } from '@/components/app-header';
import { SessionProvider } from '@/components/session-provider';

/**
 * Layout unique de toutes les pages applicatives (docs/AUTH.md).
 *
 * Il a été créé dès la Phase 1 pour centraliser le point où le contrôle de
 * session s'installerait : la Phase 4 n'a eu qu'à envelopper ce qui suit dans
 * `SessionProvider`, sans reprendre une seule page.
 *
 * Le contrôle réel reste côté backend, sur chaque requête. Ce qui se joue ici
 * est l'expérience : ne pas afficher un écran vide à qui n'est pas connecté.
 */
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-screen">
        <AppHeader />

        {/*
          Monté ici, et non dans une page : une alerte doit être vue et entendue
          quel que soit l'écran affiché — tableau de bord, historique, ou
          télévision d'open space.
        */}
        <AlertCenter />

        <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
      </div>
    </SessionProvider>
  );
}
