import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthSettings, RecoveryCodes, TwoFactorSetup, TwoFactorStatus } from '@sentinel/shared-types';
import qrcode from 'qrcode-generator';

import { ENV } from '../common/config/config.module';
import type { Env } from '../common/config/env';
import { PrismaService } from '../common/prisma/prisma.service';
import { genererCodes, ressembleAUnCodeDeRecuperation } from './recovery-codes';
import { chiffrer, dechiffrer, derriverCles, empreinteCode, memeEmpreinte, type ClesSecrets } from './secret-box';
import { construireUri, genererSecret, verifierCode } from './totp';

/** Lie un chiffré à son propriétaire : un secret recopié d'une ligne à l'autre ne se déchiffre pas. */
const contextePour = (userId: string): string => `totp:${userId}`;

/**
 * Double authentification (docs/AUTH.md).
 *
 * Deux interrupteurs se combinent : celui de l'utilisateur, et celui de
 * l'administration qui peut l'imposer à tous. La règle est simple —
 * `requise = imposée globalement || activée par l'utilisateur` — mais elle a une
 * conséquence à connaître : imposer la 2FA à tous n'appaire personne. Ceux qui
 * ne l'ont pas encore configurée doivent le faire à leur prochaine connexion,
 * et le parcours doit donc rester praticable dans cet état.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly cles: ClesSecrets;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    // Dérivée au démarrage : une clé de configuration invalide doit empêcher le
    // service de démarrer, pas surgir à la première tentative de connexion.
    this.cles = derriverCles(env.AUTH_ENCRYPTION_KEY);
  }

  // --- Réglage global -------------------------------------------------------

  async settings(): Promise<AuthSettings> {
    const ligne = await this.prisma.authSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: { id: 'singleton' },
    });
    return { twoFactorEnforced: ligne.twoFactorEnforced };
  }

  async updateSettings(dto: AuthSettings, auteur: string): Promise<AuthSettings> {
    const ligne = await this.prisma.authSettings.upsert({
      where: { id: 'singleton' },
      update: { twoFactorEnforced: dto.twoFactorEnforced, updatedBy: auteur },
      create: { id: 'singleton', twoFactorEnforced: dto.twoFactorEnforced, updatedBy: auteur },
    });
    this.logger.log(
      `Double authentification ${ligne.twoFactorEnforced ? 'imposée' : 'laissée au choix'} par « ${auteur} »`,
    );
    return { twoFactorEnforced: ligne.twoFactorEnforced };
  }

  // --- État -----------------------------------------------------------------

  async status(username: string): Promise<TwoFactorStatus> {
    const { twoFactorEnforced } = await this.settings();
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { recoveryCodes: { where: { usedAt: null }, select: { id: true } } },
    });

    return {
      enabled: user?.twoFactorEnabled === true && user.twoFactorConfirmedAt !== null,
      enforced: twoFactorEnforced,
      recoveryCodesRemaining: user?.recoveryCodes.length ?? 0,
    };
  }

  /** La double authentification est-elle exigée de cet utilisateur, et prête à l'être ? */
  async estRequise(user: Prisma.UserGetPayload<Record<string, never>>): Promise<boolean> {
    if (!user.twoFactorEnabled || user.twoFactorConfirmedAt === null) return false;
    return true;
  }

  // --- Appairage ------------------------------------------------------------

  /**
   * Prépare un appairage : nouveau secret, URI et QR code.
   *
   * Le secret est enregistré **sans être activé**. Tant qu'un premier code
   * correct ne l'a pas confirmé, il ne sert à rien : sans cette confirmation, un
   * utilisateur qui scannerait mal son QR se retrouverait enfermé dehors à la
   * connexion suivante.
   */
  async preparer(username: string): Promise<TwoFactorSetup> {
    const user = await this.utilisateurOuRefus(username);

    const secret = genererSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorSecret: chiffrer(secret, this.cles.chiffrement, contextePour(user.id)),
        twoFactorEnabled: false,
        twoFactorConfirmedAt: null,
      },
    });

    const otpauthUri = construireUri(secret, user.username);
    return { secret, otpauthUri, qrCode: this.enQrCode(otpauthUri) };
  }

  /**
   * Confirme l'appairage par un premier code, et délivre les codes de
   * récupération.
   */
  async confirmer(username: string, code: string): Promise<RecoveryCodes> {
    const user = await this.utilisateurOuRefus(username);
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Aucun appairage en cours. Recommencer depuis le début.');
    }

    const secret = dechiffrer(user.twoFactorSecret, this.cles.chiffrement, contextePour(user.id));
    if (!secret) {
      // Clé de chiffrement changée depuis l'appairage : le secret est perdu.
      this.logger.error(`Secret TOTP illisible pour « ${username} » — AUTH_ENCRYPTION_KEY a-t-elle changé ?`);
      throw new BadRequestException('Le secret enregistré est illisible. Recommencer l’appairage.');
    }

    if (!verifierCode(secret, code)) {
      throw new BadRequestException('Code incorrect. Vérifier l’heure du téléphone, puis réessayer.');
    }

    const codes = genererCodes(this.cles.empreinte);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: true, twoFactorConfirmedAt: new Date() },
      });
      // Les anciens codes ne survivent pas à un réappairage : ils
      // déverrouilleraient un compte dont le second facteur a changé.
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: codes.empreintes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
    });

    this.logger.log(`Double authentification activée pour « ${username} »`);
    return { codes: codes.enClair };
  }

  /** Régénère les codes de récupération, en invalidant les précédents. */
  async regenererCodes(username: string): Promise<RecoveryCodes> {
    const user = await this.utilisateurOuRefus(username);
    if (!user.twoFactorEnabled || user.twoFactorConfirmedAt === null) {
      throw new BadRequestException('La double authentification n’est pas activée sur ce compte.');
    }

    const codes = genererCodes(this.cles.empreinte);
    await this.prisma.$transaction(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: codes.empreintes.map((codeHash) => ({ userId: user.id, codeHash })),
      });
    });

    this.logger.log(`Codes de récupération régénérés pour « ${username} »`);
    return { codes: codes.enClair };
  }

  /**
   * Désactive la double authentification.
   *
   * Refusé si le réglage global l'impose : sinon, l'interrupteur global se
   * contournerait d'un clic et ne servirait plus à rien.
   */
  async desactiver(username: string): Promise<void> {
    const { twoFactorEnforced } = await this.settings();
    if (twoFactorEnforced) {
      throw new BadRequestException(
        'La double authentification est imposée à tous les comptes : elle ne peut pas être désactivée ici.',
      );
    }
    await this.reinitialiser(username);
    this.logger.log(`Double authentification désactivée par « ${username} »`);
  }

  /**
   * Remet un compte à zéro — appareil perdu, réinitialisation par un
   * administrateur. Le compte redevient accessible avec le seul mot de passe,
   * sauf si le réglage global impose un réappairage à la prochaine connexion.
   */
  async reinitialiser(username: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorConfirmedAt: null },
      });
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
    });
  }

  // --- Vérification à la connexion -----------------------------------------

  /**
   * Vérifie le second facteur : un code TOTP, ou un code de récupération.
   *
   * Les deux sont acceptés dans le même champ. Leur forme les distingue sans
   * ambiguïté — six chiffres contre dix lettres et chiffres — et demander à
   * l'utilisateur de choisir d'abord n'apporterait rien.
   */
  async verifierSecondFacteur(username: string, saisi: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || !user.enabled || !user.twoFactorSecret) {
      throw new UnauthorizedException('Code incorrect');
    }

    if (ressembleAUnCodeDeRecuperation(saisi)) {
      await this.consommerCodeDeRecuperation(user.id, username, saisi);
      return;
    }

    const secret = dechiffrer(user.twoFactorSecret, this.cles.chiffrement, contextePour(user.id));
    if (!secret || !verifierCode(secret, saisi)) {
      this.logger.warn(`Second facteur refusé pour « ${username} »`);
      throw new UnauthorizedException('Code incorrect');
    }
  }

  /**
   * Consomme un code de récupération.
   *
   * Marqué utilisé plutôt que supprimé : savoir qu'un code a servi, et quand,
   * fait partie de la trace d'accès. La mise à jour porte une condition sur
   * `usedAt` pour que deux tentatives simultanées ne puissent pas consommer deux
   * fois le même code.
   */
  private async consommerCodeDeRecuperation(userId: string, username: string, saisi: string): Promise<void> {
    const attendue = empreinteCode(saisi, this.cles.empreinte);
    const disponibles = await this.prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });

    // Parcours complet, sans sortie anticipée : s'arrêter au premier code
    // correspondant rendrait le temps de réponse dépendant de sa position.
    let trouve: string | null = null;
    for (const code of disponibles) {
      if (memeEmpreinte(code.codeHash, attendue)) trouve = code.id;
    }

    if (!trouve) {
      this.logger.warn(`Code de récupération refusé pour « ${username} »`);
      throw new UnauthorizedException('Code incorrect');
    }

    const { count } = await this.prisma.recoveryCode.updateMany({
      where: { id: trouve, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException('Code incorrect');

    const restants = await this.prisma.recoveryCode.count({ where: { userId, usedAt: null } });
    this.logger.warn(`Code de récupération utilisé par « ${username} » — ${restants} restant(s)`);
  }

  // --- Utilitaires ----------------------------------------------------------

  private async utilisateurOuRefus(username: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Les comptes techniques n'existent pas dans cette table, et n'ont pas de
      // second facteur : l'écran mural n'a personne pour saisir un code, et le
      // compte de secours doit fonctionner quand tout le reste est cassé.
      throw new BadRequestException(
        'La double authentification ne s’applique qu’aux comptes nominatifs, pas aux comptes techniques.',
      );
    }
    return user;
  }

  /**
   * QR code en `data:image/svg+xml;base64,…`.
   *
   * SVG plutôt que bitmap : il reste net quel que soit l'affichage, et pèse
   * quelques centaines d'octets. Renvoyé en `data:` URI plutôt qu'en balise brute
   * pour que l'interface l'affiche dans un `<img>`, sans jamais injecter de
   * balisage venu du serveur (docs/SECURITY.md A03).
   */
  private enQrCode(uri: string): string {
    // Correction d'erreur « M » : le compromis habituel entre densité et
    // tolérance aux reflets d'un écran photographié de travers.
    const qr = qrcode(0, 'M');
    qr.addData(uri);
    qr.make();

    const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
}
