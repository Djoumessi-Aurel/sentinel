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
import { TwoFactorService } from './two-factor.service';

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
  /** Session restreinte à l'appairage de la double authentification. */
  enroll?: true;
}

/**
 * Jeton de la seconde étape de connexion.
 *
 * Ce n'est **pas** une session : il ne donne accès à aucune route, expire en
 * quelques minutes, et porte un type distinct pour qu'un jeton de défi ne
 * puisse jamais être présenté comme un cookie de session.
 */
interface ChallengePayload {
  sub: string;
  typ: 'defi-2fa';
}

/** Durée de vie du défi : le temps de sortir son téléphone, pas davantage. */
const DUREE_DEFI_SECONDES = 300;

/** Connexion aboutie, ou second facteur réclamé. */
export type LoginOutcome =
  | { statut: 'ouverte'; user: CurrentUser; session: SessionToken }
  | { statut: 'second-facteur'; challengeToken: string };

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
    private readonly twoFactor: TwoFactorService,
    @Inject(DIRECTORY) private readonly directory: Directory,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async status(): Promise<AuthStatus> {
    return { mode: this.env.AUTH_MODE, directoryReachable: await this.directory.isReachable() };
  }

  async login(dto: LoginDto, origin: string): Promise<LoginOutcome> {
    const username = dto.username.trim();

    // Les comptes techniques n'ont jamais de second facteur : l'écran mural n'a
    // personne pour saisir un code, et le compte de secours doit fonctionner
    // quand tout le reste est cassé (docs/AUTH.md).
    if (isBuiltinUsername(username)) {
      const technique = await this.authenticateBuiltin(username.toLowerCase(), dto.password, origin);
      return { statut: 'ouverte', user: technique, session: this.issueSession(technique) };
    }

    const user = await this.authenticateDirectoryUser(username, dto.password, origin);
    const etat = await this.prisma.user.findUnique({ where: { username: user.username } });
    const appairee = etat?.twoFactorEnabled === true && etat.twoFactorConfirmedAt !== null;

    if (appairee) {
      this.logger.log(`Second facteur demandé à « ${username} »`);
      const payload: ChallengePayload = { sub: user.username, typ: 'defi-2fa' };
      return {
        statut: 'second-facteur',
        challengeToken: this.jwt.sign(payload, { expiresIn: DUREE_DEFI_SECONDES }),
      };
    }

    const { twoFactorEnforced } = await this.twoFactor.settings();
    if (twoFactorEnforced) {
      // Imposée, mais pas encore configurée : on ouvre une session qui ne permet
      // que l'appairage. Laisser entrer normalement viderait le réglage global
      // de tout effet ; refuser l'accès rendrait l'appairage impossible.
      this.logger.log(`Appairage de la double authentification exigé de « ${username} »`);
      const restreint: CurrentUser = { ...user, mustEnrollTwoFactor: true };
      return { statut: 'ouverte', user: restreint, session: this.issueSession(restreint) };
    }

    await this.marquerConnexion(user.username);
    return { statut: 'ouverte', user, session: this.issueSession(user) };
  }

  /**
   * Seconde étape : le jeton de défi et le code présentés ensemble.
   *
   * Le jeton ne prouve que la réussite de la première étape ; c'est le code qui
   * ouvre la session.
   */
  async completerSecondFacteur(challengeToken: string, code: string, origin: string): Promise<LoginOutcome> {
    let payload: ChallengePayload;
    try {
      payload = this.jwt.verify<ChallengePayload>(challengeToken);
    } catch {
      throw new UnauthorizedException('Session de connexion expirée. Recommencer.');
    }
    if (payload.typ !== 'defi-2fa') throw new UnauthorizedException('Session de connexion invalide.');

    await this.twoFactor.verifierSecondFacteur(payload.sub, code);

    const user = await this.prisma.user.findUnique({ where: { username: payload.sub } });
    if (!user || !user.enabled) this.refuse(payload.sub, origin, 'compte désactivé entre les deux étapes');

    await this.marquerConnexion(user.username);
    this.logger.log(`Connexion de « ${user.username} » validée par second facteur depuis ${origin}`);

    const courant: CurrentUser = {
      username: user.username,
      displayName: user.displayName,
      role: user.role as UserRole,
      builtin: false,
    };
    return { statut: 'ouverte', user: courant, session: this.issueSession(courant) };
  }

  private async marquerConnexion(username: string): Promise<void> {
    await this.prisma.user.update({ where: { username }, data: { lastLoginAt: new Date() } });
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

    // `lastLoginAt` n'est pas mis à jour ici : la connexion n'est pas encore
    // aboutie si un second facteur est réclamé. Elle l'est à l'étape suivante.
    this.logger.log(`Mot de passe validé pour « ${username} » (${user.role}) depuis ${origin}`);
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
      ...(user.mustEnrollTwoFactor ? { enroll: true as const } : {}),
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

    // Une session d'appairage cesse de l'être dès que l'appairage est fait :
    // l'utilisateur n'a pas à se reconnecter pour retrouver ses droits.
    const appairee = user.twoFactorEnabled && user.twoFactorConfirmedAt !== null;

    return {
      username: user.username,
      displayName: user.displayName,
      role: user.role as UserRole,
      builtin: false,
      ...(payload.enroll && !appairee ? { mustEnrollTwoFactor: true as const } : {}),
    };
  }
}
