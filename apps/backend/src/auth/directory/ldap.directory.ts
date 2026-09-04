import { Logger } from '@nestjs/common';
import { Client, type Entry } from 'ldapts';

import type { Env } from '../../common/config/env';
import type { Directory, DirectoryAuthResult, DirectoryPerson } from './directory.interface';
import { buildPersonSearchFilter, buildUsernameFilter } from './ldap-filter';

/**
 * Accès à l'Active Directory par LDAP.
 *
 * Deux usages distincts, avec deux liaisons différentes :
 *
 * - **authentifier** : on tente une liaison avec les identifiants de la
 *   personne. Si le serveur l'accepte, le mot de passe est bon. C'est la seule
 *   façon correcte de procéder — Sentinel ne voit jamais le mot de passe stocké
 *   dans l'annuaire, et n'en conserve aucune trace ;
 * - **chercher** : on utilise le compte de service configuré, une personne
 *   n'ayant pas nécessairement le droit de parcourir l'annuaire.
 *
 * Chaque opération ouvre puis referme sa propre connexion : une connexion
 * conservée entre deux requêtes se retrouve coupée par le pare-feu ou le
 * contrôleur de domaine au bout d'un moment, et échoue alors au pire moment.
 */
export class LdapDirectory implements Directory {
  readonly kind = 'ldap' as const;
  private readonly logger = new Logger(LdapDirectory.name);

  private readonly url: string;
  private readonly domain: string;
  private readonly baseDn: string;
  private readonly serviceUser: string;
  private readonly servicePassword: string;
  private readonly timeout: number;

  constructor(env: Env) {
    if (!env.LDAP_URL || !env.LDAP_BASE_DN) {
      throw new Error("LDAP_URL et LDAP_BASE_DN sont obligatoires lorsque AUTH_MODE vaut 'ldap'");
    }
    this.url = env.LDAP_URL;
    this.domain = env.LDAP_DOMAIN ?? '';
    this.baseDn = env.LDAP_BASE_DN;
    this.serviceUser = env.LDAP_USERNAME ?? '';
    this.servicePassword = env.LDAP_PASSWORD ?? '';
    this.timeout = env.LDAP_TIMEOUT_MS;
  }

  /** `adjoumessi` → `adjoumessi@gie.local`, sauf si le domaine est déjà présent. */
  private toPrincipal(username: string): string {
    return username.includes('@') || this.domain === '' ? username : `${username}${this.domain}`;
  }

  private newClient(): Client {
    return new Client({ url: this.url, timeout: this.timeout, connectTimeout: this.timeout });
  }

  async isReachable(): Promise<boolean> {
    const client = this.newClient();
    try {
      await client.bind(this.toPrincipal(this.serviceUser), this.servicePassword);
      return true;
    } catch (error) {
      this.logger.warn(`Annuaire injoignable : ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  async authenticate(username: string, password: string): Promise<DirectoryAuthResult> {
    // Un mot de passe vide fait, sur certains annuaires, une « liaison anonyme »
    // que le serveur accepte — et qui vaudrait authentification réussie.
    if (password.length === 0) return { authenticated: false, reason: 'invalid-credentials' };

    const client = this.newClient();
    try {
      await client.bind(this.toPrincipal(username), password);
      return { authenticated: true };
    } catch (error) {
      if (this.isInvalidCredentials(error)) {
        // Un mot de passe erroné est un événement ordinaire : on ne pollue pas
        // les journaux avec, mais on ne dit pas non plus lequel des deux champs
        // est faux (docs/SECURITY.md A07).
        return { authenticated: false, reason: 'invalid-credentials' };
      }

      this.logger.error(
        `Échec technique de l'authentification LDAP : ${error instanceof Error ? error.message : String(error)}`,
      );
      return { authenticated: false, reason: 'unreachable' };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /**
   * Distingue un refus d'identifiants d'une panne. Active Directory renvoie le
   * code 49 avec un sous-code : `52e` désigne précisément un mot de passe
   * incorrect, les autres (`533` compte désactivé, `775` compte verrouillé…)
   * sont également des refus, non des pannes.
   */
  private isInvalidCredentials(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const nom = error.name;
    const message = error.message ?? '';
    return (
      nom === 'InvalidCredentialsError' ||
      message.includes('data 52e') ||
      message.includes('data 525') ||
      message.includes('data 530') ||
      message.includes('data 531') ||
      message.includes('data 532') ||
      message.includes('data 533') ||
      message.includes('data 701') ||
      message.includes('data 773') ||
      message.includes('data 775')
    );
  }

  async search(needle: string, limit: number): Promise<DirectoryPerson[]> {
    return this.runSearch(buildPersonSearchFilter(needle), limit);
  }

  async findByUsername(username: string): Promise<DirectoryPerson | null> {
    const [personne] = await this.runSearch(buildUsernameFilter(username), 1);
    return personne ?? null;
  }

  private async runSearch(filter: string, limit: number): Promise<DirectoryPerson[]> {
    const client = this.newClient();
    try {
      await client.bind(this.toPrincipal(this.serviceUser), this.servicePassword);
      const { searchEntries } = await client.search(this.baseDn, {
        scope: 'sub',
        filter,
        // `sizeLimit` est appliqué par le serveur : on ne rapatrie pas l'annuaire
        // entier pour n'en garder que dix entrées.
        sizeLimit: limit,
        attributes: ['sAMAccountName', 'displayName', 'cn', 'mail'],
      });

      return searchEntries
        .map((entry) => this.toPerson(entry))
        .filter((personne): personne is DirectoryPerson => personne !== null);
    } catch (error) {
      this.logger.error(`Recherche LDAP en échec : ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }

  /** Un attribut LDAP peut être absent, unique ou multivalué. */
  private first(value: Entry[string] | undefined): string | null {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) {
      const premier = value[0];
      return premier === undefined ? null : String(premier);
    }
    return String(value);
  }

  private toPerson(entry: Entry): DirectoryPerson | null {
    const username = this.first(entry['sAMAccountName']);
    // Sans identifiant de connexion, l'entrée est inexploitable : un compte
    // ajouté sur cette base ne pourrait jamais se connecter.
    if (!username) return null;

    return {
      username,
      displayName: this.first(entry['displayName']) ?? this.first(entry['cn']) ?? username,
      email: this.first(entry['mail']),
    };
  }
}
