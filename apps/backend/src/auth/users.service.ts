import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  isBuiltinUsername,
  type CreateUserDto,
  type DirectoryEntry,
  type UpdateUserDto,
  type User,
  type UserRole,
} from '@sentinel/shared-types';

import type { RequestUser } from '../common/auth/request-user';
import { PrismaService } from '../common/prisma/prisma.service';
import { DIRECTORY, type Directory } from './directory/directory.interface';

/** Plafond de résultats d'une recherche dans l'annuaire. */
const SEARCH_LIMIT = 25;

/**
 * Gestion des utilisateurs de Sentinel (docs/AUTH.md).
 *
 * Un utilisateur n'est jamais saisi à la main : il est **choisi dans
 * l'annuaire**. Cela garantit que l'identifiant enregistré correspond
 * exactement à un `sAMAccountName` existant — une faute de frappe produirait un
 * compte qui ne pourrait jamais se connecter, et dont personne ne comprendrait
 * pourquoi.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DIRECTORY) private readonly directory: Directory,
  ) {}

  async list(): Promise<User[]> {
    const rows = await this.prisma.user.findMany({ orderBy: [{ enabled: 'desc' }, { username: 'asc' }] });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Recherche dans l'annuaire, en signalant qui est déjà utilisateur.
   *
   * Sans cette indication, un administrateur ajouterait deux fois la même
   * personne et ne comprendrait le refus qu'après coup.
   */
  async searchDirectory(needle: string): Promise<DirectoryEntry[]> {
    const personnes = await this.directory.search(needle, SEARCH_LIMIT);
    if (personnes.length === 0) return [];

    const existants = await this.prisma.user.findMany({
      where: { username: { in: personnes.map((p) => p.username) } },
      select: { username: true },
    });
    const deja = new Set(existants.map((u) => u.username.toLowerCase()));

    return personnes.map((personne) => ({
      username: personne.username,
      displayName: personne.displayName,
      email: personne.email,
      alreadyRegistered: deja.has(personne.username.toLowerCase()),
    }));
  }

  async create(dto: CreateUserDto, auteur: RequestUser): Promise<User> {
    const username = dto.username.trim();

    // Les comptes techniques sont définis par la configuration du serveur : les
    // laisser créer en base produirait deux définitions concurrentes du même
    // nom, avec des rôles potentiellement contradictoires.
    if (isBuiltinUsername(username)) {
      throw new BadRequestException(
        `« ${username} » est un compte technique, défini dans la configuration du serveur. Il ne s’ajoute pas ici.`,
      );
    }

    const existant = await this.prisma.user.findUnique({ where: { username } });
    if (existant) throw new BadRequestException(`« ${username} » est déjà utilisateur de Sentinel.`);

    // On repasse par l'annuaire pour figer le nom affiché et l'adresse au moment
    // de l'ajout, et surtout pour refuser un identifiant qui n'y existe pas.
    const personne = await this.directory.findByUsername(username);
    if (!personne) {
      throw new BadRequestException(
        `« ${username} » est introuvable dans l’annuaire. Un compte Active Directory est nécessaire.`,
      );
    }

    const row = await this.prisma.user.create({
      data: {
        username: personne.username,
        displayName: personne.displayName,
        email: personne.email,
        role: dto.role,
        createdBy: auteur.username,
        updatedBy: auteur.username,
      },
    });
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateUserDto, auteur: RequestUser): Promise<User> {
    const user = await this.findOrThrow(id);

    // Se retirer soi-même le rôle d'administrateur, ou se désactiver, laisserait
    // potentiellement l'application sans personne pour l'administrer.
    if (user.username === auteur.username) {
      if (dto.role !== undefined && dto.role !== user.role) {
        throw new ForbiddenException('Vous ne pouvez pas modifier votre propre rôle.');
      }
      if (dto.enabled === false) {
        throw new ForbiddenException('Vous ne pouvez pas désactiver votre propre compte.');
      }
    }

    if (dto.role !== undefined || dto.enabled === false) {
      await this.assertRestentDesAdministrateurs(user, dto);
    }

    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        updatedBy: auteur.username,
      },
    });
    return this.toDto(row);
  }

  /**
   * Empêche de retirer le dernier administrateur actif.
   *
   * Le compte technique `sentineladmin` reste un filet de sécurité, mais compter
   * dessus au quotidien reviendrait à partager un mot de passe unique entre
   * plusieurs personnes — précisément ce que la gestion nominative évite.
   */
  private async assertRestentDesAdministrateurs(
    cible: { id: string; role: string; enabled: boolean },
    dto: UpdateUserDto,
  ): Promise<void> {
    const perdSonRole = cible.role === 'admin' && (dto.role === 'viewer' || dto.enabled === false);
    if (!perdSonRole) return;

    const autresAdmins = await this.prisma.user.count({
      where: { role: 'admin', enabled: true, id: { not: cible.id } },
    });
    if (autresAdmins === 0) {
      throw new BadRequestException(
        'C’est le dernier administrateur actif. En désigner un autre avant de retirer celui-ci.',
      );
    }
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Utilisateur ${id} introuvable`);
    return row;
  }

  private toDto(row: Prisma.UserGetPayload<Record<string, never>>): User {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      email: row.email,
      role: row.role as UserRole,
      enabled: row.enabled,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
