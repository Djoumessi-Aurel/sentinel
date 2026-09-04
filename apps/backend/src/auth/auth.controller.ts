import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  authSettingsSchema,
  loginSchema,
  twoFactorChallengeSchema,
  twoFactorVerifySchema,
  type AuthSettings,
  type AuthStatus,
  type CurrentUser as CurrentUserDto,
  type LoginDto,
  type LoginResult,
  type RecoveryCodes,
  type TwoFactorChallengeDto,
  type TwoFactorSetup,
  type TwoFactorStatus,
  type TwoFactorVerifyDto,
} from '@sentinel/shared-types';
import type { Request, Response } from 'express';

import { AuthGuard, SESSION_COOKIE } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AllowedDuringEnrollment } from '../common/auth/enrollment.decorator';
import { Public } from '../common/auth/public.decorator';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import type { RequestUser } from '../common/auth/request-user';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { AuthService, type LoginOutcome, type SessionToken } from './auth.service';
import { TwoFactorService } from './two-factor.service';

@Controller('auth')
@UseGuards(AuthGuard, RolesGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /**
   * État de l'authentification, consultable **sans session** : la page de
   * connexion doit pouvoir avertir que l'annuaire est injoignable, ou que le
   * mode dégradé de développement est actif, avant toute tentative.
   */
  @Public()
  @Get('status')
  status(): Promise<AuthStatus> {
    return this.auth.status();
  }

  /**
   * Quota volontairement serré : cinq tentatives par minute et par adresse.
   * Sans lui, rien n'empêcherait d'essayer des mots de passe en boucle — et
   * chaque essai serait relayé à l'annuaire, jusqu'à verrouiller le compte
   * d'un utilisateur légitime (docs/SECURITY.md A07).
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(zodBody(loginSchema)) dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    return this.conclure(await this.auth.login(dto, request.ip ?? 'origine inconnue'), response);
  }

  /**
   * Seconde étape de connexion.
   *
   * Limitée séparément, et plus sévèrement que le reste : six chiffres se
   * devinent en un million d'essais, ce qui est peu (docs/SECURITY.md A07).
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/challenge')
  @HttpCode(HttpStatus.OK)
  async challenge(
    @Body(zodBody(twoFactorChallengeSchema)) dto: TwoFactorChallengeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const resultat = await this.auth.completerSecondFacteur(
      dto.challengeToken,
      dto.code,
      request.ip ?? 'origine inconnue',
    );
    return this.conclure(resultat, response);
  }

  /** État de la double authentification pour l'utilisateur connecté. */
  @AllowedDuringEnrollment()
  @Get('2fa/status')
  twoFactorStatus(@CurrentUser() user: RequestUser): Promise<TwoFactorStatus> {
    return this.twoFactor.status(user.username);
  }

  /** Prépare un appairage : secret, URI et QR code. N'active rien. */
  @AllowedDuringEnrollment()
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(@CurrentUser() user: RequestUser): Promise<TwoFactorSetup> {
    return this.twoFactor.preparer(user.username);
  }

  /** Confirme l'appairage par un premier code, et délivre les codes de récupération. */
  @AllowedDuringEnrollment()
  @Post('2fa/confirm')
  @HttpCode(HttpStatus.OK)
  confirmTwoFactor(
    @Body(zodBody(twoFactorVerifySchema)) dto: TwoFactorVerifyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<RecoveryCodes> {
    return this.twoFactor.confirmer(user.username, dto.code);
  }

  /** Régénère les codes de récupération. Les précédents cessent de fonctionner. */
  @Post('2fa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  regenerateRecoveryCodes(@CurrentUser() user: RequestUser): Promise<RecoveryCodes> {
    return this.twoFactor.regenererCodes(user.username);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTwoFactor(@CurrentUser() user: RequestUser): Promise<void> {
    await this.twoFactor.desactiver(user.username);
  }

  /** Réglage global. Consultable par tous — la page de compte l'affiche —, modifiable par un admin. */
  @Get('settings')
  @AllowedDuringEnrollment()
  authSettings(): Promise<AuthSettings> {
    return this.twoFactor.settings();
  }

  @Roles('admin')
  @Patch('settings')
  updateAuthSettings(
    @Body(zodBody(authSettingsSchema)) dto: AuthSettings,
    @CurrentUser() user: RequestUser,
  ): Promise<AuthSettings> {
    return this.twoFactor.updateSettings(dto, user.username);
  }

  /**
   * Dépose le cookie quand la session est ouverte, ou renvoie le défi.
   *
   * Le jeton de défi voyage dans le corps de la réponse et non dans un cookie :
   * il ne doit surtout pas être confondu avec une session par la suite.
   */
  private conclure(resultat: LoginOutcome, response: Response): LoginResult {
    if (resultat.statut === 'second-facteur') {
      return { requiresTwoFactor: true, challengeToken: resultat.challengeToken };
    }
    this.setSessionCookie(response, resultat.session);
    return resultat.user;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(SESSION_COOKIE, this.cookieOptions(0));
  }

  @AllowedDuringEnrollment()
  @Get('me')
  me(@CurrentUser() user: RequestUser): CurrentUserDto {
    return {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      builtin: user.builtin,
      ...(user.mustEnrollTwoFactor ? { mustEnrollTwoFactor: true as const } : {}),
    };
  }

  private setSessionCookie(response: Response, session: SessionToken): void {
    response.cookie(SESSION_COOKIE, session.token, this.cookieOptions(session.maxAge * 1000));
  }

  private cookieOptions(maxAgeMs: number) {
    return {
      // Inaccessible au JavaScript de la page : un script injecté ne peut pas
      // dérober la session (docs/SECURITY.md A02).
      httpOnly: true,
      // Le cookie n'est pas envoyé lors d'une navigation venue d'un autre site,
      // ce qui bloque les requêtes forgées.
      sameSite: 'lax' as const,
      // `secure` seulement derrière HTTPS : l'imposer en développement, servi en
      // clair sur localhost, empêcherait toute connexion.
      secure: process.env['NODE_ENV'] === 'production',
      path: '/',
      maxAge: maxAgeMs,
    };
  }
}
