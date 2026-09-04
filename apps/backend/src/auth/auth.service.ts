import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  BUILTIN_ACCOUNTS,
  isBuiltinUsername,
  type AuthStatus,
  type CurrentUser,
  type LoginDto,
  type UserRole,
} from '@sentinel/shared-types';

import { ENV } from '../common/config/config.module';
import type { Env } from '../common/config/env';
import { PrismaService } from '../common/prisma/prisma.service';
import { DIRECTORY, type Directory } from './directory/directory.interface';
import { verifyPassword } from './password-hash';

export interface SessionToken {
  token: string;
  /** Durée de vie, en secondes — utilisée pour le cookie. */
  maxAge: number;
}

interface JwtPayload {
  sub: string;
  role: UserRole;
  name: string;
  builtin: boolean;
}

/**
 * Authentification (docs/AUTH.md).
 *
 * Trois chemins, dans cet ordre :
 *
 * 1. **Comptes techniques** (`sentineladmin`, `sentineluser`) : mot de passe
 *    vérifié contre une empreinte de la configuration serveur, sans contacter
 *    l'annuaire. Le super administrateur est le seul accès garanti au tout
 *    premier démarrage ; le compte d'affichage sert le grand écran de l'open
 *    space, qui doit pouvoir se connecter même si l'annuaire est en panne.
 * 2. **Utilisateur déclaré** : on vérifie d'abord qu'il figure dans la liste et
 *    qu'il est actif, **avant** de solliciter l'annuaire. Un compte AD valide ne
 *    suffit pas à entrer, et cela évite d'envoyer à l'annuaire les tentatives de
 *    connexion de gens qui n'ont de toute façon aucun droit ici.
 * 3. **Annuaire** : le mot de passe est vérifié par liaison LDAP. Sentinel ne le
 *    voit qu'en transit et n'en conserve rien.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(DIRECTORY) private readonly directory: Directory,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async status(): Promise<AuthStatus> {
    return { mode: this.env.AUTH_MODE, directoryReachable: await this.directory.isReachable() };
  }

  async login(dto: LoginDto, origin: string): Promise<{ user: CurrentUser; session: SessionToken }> {
    const username = dto.username.trim();

    const user = isBuiltinUsername(username)
      ? await this.authenticateBuiltin(username.toLowerCase(), dto.password, origin)
      : await this.authenticateDirectoryUser(username, dto.password, origin);

    return { user, session: this.issueSession(user) };
  }

  /** Comptes techniques : empreinte locale, aucun appel à l'annuaire. */
  private async authenticateBuiltin(username: string, password: string, origin: string): Promise<CurrentUser> {
    const comptes: Record<string, { hash: string | undefined; role: UserRole; displayName: string }> = {
      [BUILTIN_ACCOUNTS.superAdmin]: {
        hash: this.env.SENTINEL_ADMIN_PASSWORD_HASH,
        role: 'admin',
        displayName: 'Super administrateur',
      },
      [BUILTIN_ACCOUNTS.viewer]: {
        hash: this.env.SENTINEL_USER_PASSWORD_HASH,
        role: 'viewer',
        displayName: 'Écran de supervision',
      },
    };

    const compte = comptes[username];
    if (!compte?.hash) {
      // Empreinte absente de la configuration : le compte n'existe pas. On
      // répond comme pour un mot de passe faux, sans révéler la différence.
      this.refuse(username, origin, 'compte technique non configuré');
    }

    if (!(await verifyPassword(password, compte.hash))) {
      this.refuse(username, origin, 'mot de passe incorrect');
    }

    this.logger.log(`Connexion du compte technique « ${username} » depuis ${origin}`);
    return { username, displayName: compte.displayName, role: compte.role, builtin: true };
  }

  private async authenticateDirectoryUser(username: string, password: string, origin: string): Promise<CurrentUser> {
    // Étape 1 : la personne est-elle autorisée ici ? Cette vérification précède
    // délibérément l'appel à l'annuaire.
    const user = await this.prisma.user.findUnique({ where: { username } });

    if (!user) this.refuse(username, origin, 'utilisateur non déclaré');
    if (!user.enabled) this.refuse(username, origin, 'compte désactivé');

    // Étape 2 : le mot de passe, vérifié par l'annuaire.
    const resultat = await this.directory.authenticate(username, password);

    if (!resultat.authenticated) {
      if (resultat.reason === 'unreachable') {
        this.logger.error(`Annuaire injoignable lors de la connexion de « ${username} » depuis ${origin}`);
        throw new UnauthorizedException(
          "L'annuaire est injoignable : impossible de vérifier le mot de passe. Réessayer plus tard.",
        );
      }
      this.refuse(username, origin, 'refusé par l’annuaire');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    this.logger.log(`Connexion de « ${username} » (${user.role}) depuis ${origin}`);
    return {
      username: user.username,
      displayName: user.displayName,
      role: user.role as UserRole,
      builtin: false,
    };
  }

  /**
   * Refus uniforme. Le message renvoyé ne dit jamais *laquelle* des conditions a
   * échoué : distinguer « utilisateur inconnu » de « mot de passe incorrect »
   * permettrait d'énumérer les comptes existants (docs/SECURITY.md A07). La
   * raison précise n'existe que dans les journaux du serveur.
   */
  private refuse(username: string, origin: string, raison: string): never {
    this.logger.warn(`Connexion refusée pour « ${username} » depuis ${origin} : ${raison}`);
    throw new UnauthorizedException('Identifiants incorrects ou accès non autorisé');
  }

  private issueSession(user: CurrentUser): SessionToken {
    // Le compte d'affichage reçoit une session bien plus longue : personne ne se
    // reconnecte sur le grand écran de l'open space, et une session expirée y
    // ferait disparaître la supervision sans que quiconque le remarque.
    const maxAge =
      user.username === BUILTIN_ACCOUNTS.viewer
        ? this.env.AUTH_VIEWER_SESSION_DAYS * 86_400
        : this.env.AUTH_SESSION_HOURS * 3600;

    const payload: JwtPayload = {
      sub: user.username,
      role: user.role,
      name: user.displayName,
      builtin: user.builtin,
    };

    return { token: this.jwt.sign(payload, { expiresIn: maxAge }), maxAge };
  }

  /**
   * Résout la session portée par un jeton.
   *
   * Le rôle et l'état du compte sont **relus à chaque requête**, jamais repris
   * du jeton : sans cela, désactiver un utilisateur ou lui retirer le rôle
   * d'administrateur ne prendrait effet qu'à l'expiration de sa session, soit
   * des heures plus tard.
   */
  async resolveSession(token: string): Promise<CurrentUser | null> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      return null;
    }

    if (payload.builtin) {
      const role: UserRole = payload.sub === BUILTIN_ACCOUNTS.superAdmin ? 'admin' : 'viewer';
      const configure =
        payload.sub === BUILTIN_ACCOUNTS.superAdmin
          ? this.env.SENTINEL_ADMIN_PASSWORD_HASH
          : this.env.SENTINEL_USER_PASSWORD_HASH;
      // Retirer l'empreinte de la configuration doit invalider les sessions en
      // cours du compte concerné.
      if (!configure) return null;
      return { username: payload.sub, displayName: payload.name, role, builtin: true };
    }

    const user = await this.prisma.user.findUnique({ where: { username: payload.sub } });
    if (!user || !user.enabled) return null;

    return {
      username: user.username,
      displayName: user.displayName,
      role: user.role as UserRole,
      builtin: false,
    };
  }
}
