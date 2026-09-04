import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  createUserSchema,
  searchDirectorySchema,
  updateUserSchema,
  type CreateUserDto,
  type DirectoryEntry,
  type SearchDirectoryDto,
  type UpdateUserDto,
  type User,
} from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { RequestUser } from '../common/auth/request-user';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

/**
 * Administration des utilisateurs (docs/AUTH.md).
 *
 * Réservé au rôle `admin` dans son intégralité, y compris la lecture : la liste
 * des utilisateurs et la recherche dans l'annuaire renseignent sur
 * l'organisation, et n'ont pas à être exposées à un simple lecteur.
 *
 * **Aucune suppression.** Retirer l'accès à quelqu'un se fait en le désactivant.
 * Une suppression effacerait la trace de qui a eu accès et quand — précisément
 * ce qu'on veut pouvoir consulter après coup — et rien ne la distinguerait d'un
 * clic malheureux. Un compte désactivé, lui, se réactive.
 */
@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<User[]> {
    return this.users.list();
  }

  /** Recherche dans l'annuaire, préalable obligatoire à tout ajout. */
  @Get('directory')
  search(@Query(zodBody(searchDirectorySchema)) query: SearchDirectoryDto): Promise<DirectoryEntry[]> {
    return this.users.searchDirectory(query.q);
  }

  @Post()
  create(@Body(zodBody(createUserSchema)) dto: CreateUserDto, @CurrentUser() user: RequestUser): Promise<User> {
    return this.users.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(zodBody(updateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() user: RequestUser,
  ): Promise<User> {
    return this.users.update(id, dto, user);
  }
}
