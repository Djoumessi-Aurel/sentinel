import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { loginSchema, type AuthStatus, type CurrentUser as CurrentUserDto, type LoginDto } from '@sentinel/shared-types';
import type { Request, Response } from 'express';

import { AuthGuard, SESSION_COOKIE } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { Public } from '../common/auth/public.decorator';
import type { RequestUser } from '../common/auth/request-user';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { AuthService, type SessionToken } from './auth.service';

@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
  ): Promise<CurrentUserDto> {
    const { user, session } = await this.auth.login(dto, request.ip ?? 'origine inconnue');
    this.setSessionCookie(response, session);
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(SESSION_COOKIE, this.cookieOptions(0));
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): CurrentUserDto {
    return {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      builtin: user.builtin,
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
