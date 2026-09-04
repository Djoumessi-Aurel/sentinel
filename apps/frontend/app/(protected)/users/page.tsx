'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  USER_ROLES,
  type AuthSettings,
  type DirectoryEntry,
  type User,
  type UserRole,
} from '@sentinel/shared-types';

import { api } from '@/lib/api-client';
import { usePeut, useSession } from '@/components/session-provider';

const dateCourte = (iso: string | null): string =>
  iso === null ? 'jamais' : new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Gestion des utilisateurs (docs/AUTH.md §2).
 *
 * Personne ne se saisit à la main : on cherche dans l'annuaire, et on choisit.
 * L'identifiant enregistré correspond ainsi toujours à un compte qui existe —
 * une faute de frappe produirait un utilisateur incapable de se connecter, et
 * dont personne ne comprendrait pourquoi.
 */
export default function PageUtilisateurs() {
  const { user: connecte } = useSession();
  const gestionnaire = usePeut('gererLesUtilisateurs');
  const [utilisateurs, setUtilisateurs] = useState<User[] | null>(null);
  const [reglages, setReglages] = useState<AuthSettings | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const [liste, reglagesAuth] = await Promise.all([api.users.list(), api.auth.settings()]);
      setUtilisateurs(liste);
      setReglages(reglagesAuth);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    if (gestionnaire) void charger();
  }, [charger, gestionnaire]);

  const agir = async (action: () => Promise<unknown>, succes: string) => {
    setErreur(null);
    setMessage(null);
    try {
      await action();
      setMessage(succes);
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Action impossible');
    }
  };

  if (!gestionnaire) {
    return (
      <div className="rounded-lg border border-slate-200 bg-surface-raised p-4 text-sm text-slate-600">
        Cet écran est réservé aux administrateurs.
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Utilisateurs</h1>
        <p className="mt-1 text-sm text-slate-500">
          L’accès à Sentinel demande un compte Active Directory <em>et</em> d’être déclaré ici. Les deux sont
          nécessaires.
        </p>
      </div>

      {erreur && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {erreur}
        </p>
      )}
      {message && (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
      )}

      <AjoutDepuisAnnuaire
        onAjout={(username, role) => agir(() => api.users.create({ username, role }), `${username} a été ajouté.`)}
      />

      <section className="rounded-lg border border-slate-200 bg-surface-raised">
        <h2 className="border-b border-slate-200 px-4 py-3 font-medium">
          Utilisateurs déclarés
          {utilisateurs && <span className="ml-2 text-sm font-normal text-slate-500">({utilisateurs.length})</span>}
        </h2>

        {utilisateurs === null ? (
          <p className="px-4 py-6 text-sm text-slate-500">Chargement…</p>
        ) : utilisateurs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Aucun utilisateur déclaré. Seuls les comptes techniques peuvent se connecter.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-2 font-medium">Personne</th>
                  <th className="px-4 py-2 font-medium">Rôle</th>
                  <th className="px-4 py-2 font-medium">Dernière connexion</th>
                  <th className="px-4 py-2 font-medium">2FA</th>
                  <th className="px-4 py-2 font-medium">État</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {utilisateurs.map((u) => {
                  const soiMeme = u.username === connecte.username;
                  return (
                    <tr key={u.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className={u.enabled ? '' : 'text-slate-400'}>
                          {u.displayName}
                          {soiMeme && <span className="ml-1.5 text-xs text-slate-500">(vous)</span>}
                        </div>
                        <div className="text-xs text-slate-500">
                          {u.username}
                          {u.email && ` · ${u.email}`}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          value={u.role}
                          disabled={soiMeme}
                          onChange={(e) =>
                            agir(
                              () => api.users.update(u.id, { role: e.target.value as UserRole }),
                              `Rôle de ${u.username} modifié.`,
                            )
                          }
                          title={soiMeme ? 'On ne modifie pas son propre rôle.' : undefined}
                          className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          {USER_ROLES.map((r) => (
                            <option key={r} value={r} title={ROLE_DESCRIPTIONS[r]}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{dateCourte(u.lastLoginAt)}</td>
                      <td className="px-4 py-2.5">
                        {u.twoFactorEnabled ? (
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">active</span>
                            {/*
                              Bouton nommé, et non un badge cliquable : l'action de
                              retrait doit se voir. C'est le seul moyen d'enlever la
                              double authentification d'un compte, et on l'a
                              cherchée.
                            */}
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  !confirm(
                                    `Retirer la double authentification de ${u.displayName} ? Cette personne se reconnectera avec son seul mot de passe, et pourra la réactiver quand elle voudra.`,
                                  )
                                ) {
                                  return;
                                }
                                void agir(
                                  () => api.users.update(u.id, { twoFactorEnabled: false }),
                                  `La double authentification de ${u.username} a été retirée.`,
                                );
                              }}
                              title="Téléphone perdu, ou retrait à la demande"
                              className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 transition hover:bg-slate-100"
                            >
                              Retirer
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.enabled ? (
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">actif</span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">désactivé</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={soiMeme}
                            onClick={() =>
                              agir(
                                () => api.users.update(u.id, { enabled: !u.enabled }),
                                u.enabled ? `${u.username} a été désactivé.` : `${u.username} a été réactivé.`,
                              )
                            }
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
                          >
                            {u.enabled ? 'Désactiver' : 'Réactiver'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          Pour retirer l’accès à quelqu’un, on le désactive : l’historique reste consultable, et le compte se réactive
          au besoin. Il n’y a pas de suppression — elle effacerait la trace de qui a eu accès et quand, et rien ne la
          distinguerait d’un clic malheureux. Le compte Active Directory n’est jamais touché. On ne peut ni modifier son
          propre rôle, ni se désactiver, ni retirer le dernier administrateur actif.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
        <h2 className="font-medium">Double authentification</h2>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={reglages?.twoFactorEnforced ?? false}
            disabled={reglages === null}
            onChange={(e) =>
              agir(
                () => api.auth.updateSettings({ twoFactorEnforced: e.target.checked }),
                e.target.checked
                  ? 'La double authentification est désormais obligatoire.'
                  : 'La double authentification redevient facultative.',
              )
            }
          />
          <span>
            L’imposer à tous les comptes nominatifs
            <span className="mt-0.5 block text-xs text-slate-500">
              Les comptes qui ne l’ont pas encore configurée ne pourront rien faire d’autre que l’activer, à leur
              prochaine connexion. Les deux comptes techniques ne sont pas concernés : l’écran mural n’a personne pour
              saisir un code, et le compte de secours doit fonctionner quand tout le reste est cassé.
            </span>
            <span className="mt-1.5 block text-xs text-slate-500">
              <strong>Décocher lève l’obligation, mais ne retire l’appairage de personne.</strong> Chacun garde le sien
              et continue de saisir un code — c’est voulu : on ne retire pas silencieusement une protection que
              quelqu’un a choisie. Pour l’enlever à une personne, utilisez « Retirer » dans la colonne 2FA ; chacun peut
              aussi le faire depuis son écran <em>Mon compte</em>.
            </span>
          </span>
        </label>
      </section>

      <section className="rounded-lg border border-slate-200 bg-surface-raised p-4">
        <h2 className="font-medium">Comptes techniques</h2>
        <p className="mt-1 text-sm text-slate-600">
          Deux comptes ne figurent pas dans cette liste et ne s’y ajoutent pas : ils sont définis par la configuration du
          serveur et n’ont pas de correspondant dans l’annuaire.
        </p>
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          <li>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">sentineluser</code> — lecteur, pour l’écran de
            l’open space. Session de longue durée pour que l’affichage ne se déconnecte pas seul.
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">sentineladmin</code> — super administrateur.
            Filet de sécurité, pas un compte de travail : s’en servir au quotidien revient à partager un mot de passe.
          </li>
        </ul>
      </section>
    </div>
  );
}

/** Recherche dans l'annuaire, puis ajout de la personne choisie. */
function AjoutDepuisAnnuaire({ onAjout }: { onAjout: (username: string, role: UserRole) => Promise<void> }) {
  const [fragment, setFragment] = useState('');
  const [resultats, setResultats] = useState<DirectoryEntry[] | null>(null);
  const [recherche, setRecherche] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>('viewer');

  // Deux caractères minimum, comme le backend : chercher sur une seule lettre
  // ramènerait tout l'annuaire.
  const assezLong = fragment.trim().length >= 2;

  useEffect(() => {
    if (!assezLong) {
      setResultats(null);
      setErreur(null);
      return;
    }

    // Temporisation : sans elle, chaque frappe déclencherait une requête LDAP.
    const minuterie = setTimeout(async () => {
      setRecherche(true);
      try {
        setResultats(await api.users.searchDirectory(fragment.trim()));
        setErreur(null);
      } catch (e) {
        setResultats(null);
        setErreur(e instanceof Error ? e.message : 'Recherche impossible');
      } finally {
        setRecherche(false);
      }
    }, 350);

    return () => clearTimeout(minuterie);
  }, [fragment, assezLong]);

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-surface-raised p-4">
      <h2 className="font-medium">Ajouter une personne</h2>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="recherche-annuaire" className="mb-1 block text-sm text-slate-600">
            Chercher dans l’annuaire
          </label>
          <input
            id="recherche-annuaire"
            value={fragment}
            onChange={(e) => setFragment(e.target.value)}
            placeholder="identifiant, nom ou prénom"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
        </div>
        <div>
          <label htmlFor="role-ajout" className="mb-1 block text-sm text-slate-600">
            Rôle à donner
          </label>
          <select
            id="role-ajout"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="rounded border border-slate-300 px-2 py-2 text-sm"
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r} title={ROLE_DESCRIPTIONS[r]}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <p className="mt-1 max-w-xs text-xs text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
        </div>
      </div>

      {erreur && <p className="text-sm text-red-700">{erreur}</p>}

      {!assezLong ? (
        <p className="text-xs text-slate-500">Deux caractères au minimum. La recherche porte sur l’identifiant, le nom
          affiché et l’adresse.</p>
      ) : recherche ? (
        <p className="text-sm text-slate-500">Recherche…</p>
      ) : resultats === null ? null : resultats.length === 0 ? (
        <p className="text-sm text-slate-500">Personne ne correspond à « {fragment.trim()} » dans l’annuaire.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {resultats.map((personne) => (
            <li key={personne.username} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div>{personne.displayName}</div>
                <div className="text-xs text-slate-500">
                  {personne.username}
                  {personne.email && ` · ${personne.email}`}
                </div>
              </div>
              {personne.alreadyRegistered ? (
                <span className="text-xs text-slate-500">déjà utilisateur</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void onAjout(personne.username, role).then(() => setFragment(''));
                  }}
                  className="rounded bg-sky-700 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-800"
                >
                  Ajouter comme {ROLE_LABELS[role]}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
