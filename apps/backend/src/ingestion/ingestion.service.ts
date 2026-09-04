import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { parserRegistry, type ParseContext } from '@sentinel/log-parsers';
import type { IngestLogsDto, IngestionAccepted, StoredLogEntry } from '@sentinel/shared-types';
import { randomUUID } from 'node:crypto';

import { AlertingService } from '../alerting/alerting.service';
import { ApplicationsService } from '../applications/applications.service';
import { ENV } from '../common/config/config.module';
import type { Env } from '../common/config/env';
import { INTERNAL_EVENTS, type LogIngestedEvent } from '../events';
import { LOG_STORE, type LogStore } from '../log-store/log-store.interface';
import { RedactionService } from '../redaction/redaction.service';

/**
 * Longueur maximale d'un message après rattachement des lignes de continuation.
 * Une stack trace de plusieurs milliers de lignes ne doit pas produire une
 * entrée illisible ni saturer le stockage (docs/SECURITY.md A04).
 */
const MAX_MESSAGE_LENGTH = 16_000;

/** Séquences d'échappement ANSI (couleurs de terminal) : ESC [ ... lettre. */
const ANSI_ESCAPE = /\u001B\[[0-9;]*[A-Za-z]/g;

/**
 * Caractères de contrôle, tabulation (\u0009) et saut de ligne (\u000A) exclus :
 * le saut de ligne porte le rattachement des lignes de stack trace. Le retour
 * chariot (\u000D), lui, est bien retiré : c'est le vecteur classique de
 * falsification de l'affichage des entrées voisines.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @Inject(LOG_STORE) private readonly logStore: LogStore,
    @Inject(ENV) private readonly env: Env,
    private readonly applications: ApplicationsService,
    private readonly redaction: RedactionService,
    private readonly alerting: AlertingService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Pipeline d'ingestion d'un lot de lignes.
   *
   * Ordre volontaire : parsing → masquage → écriture → publication. L'écriture
   * n'attend jamais l'évaluation des règles (docs/CLAUDE.md §8) : l'agent est
   * acquitté dès que les logs sont persistés, l'analyse suit de façon asynchrone.
   */
  async ingestLogs(dto: IngestLogsDto): Promise<IngestionAccepted> {
    const application = await this.applications.findRowOrThrow(dto.applicationId);

    const parser = parserRegistry.get(application.type);
    const context: ParseContext = {
      applicationId: application.id,
      server: dto.server,
      sourceUtcOffsetMinutes: this.env.LOG_SOURCE_UTC_OFFSET_MINUTES,
    };

    const entries: StoredLogEntry[] = [];
    let skipped = 0;

    for (const line of dto.lines) {
      // Les lignes de continuation (stack traces) prolongent l'entrée
      // précédente au lieu d'en créer une nouvelle : une exception Java doit
      // rester **une** entrée, sinon l'écran devient illisible et le compte
      // d'erreurs des règles est faussé.
      if (parser.isContinuation?.(line.raw) && entries.length > 0) {
        const previous = entries[entries.length - 1]!;
        if (previous.message.length < MAX_MESSAGE_LENGTH) {
          previous.message = `${previous.message}\n${this.redaction.redact(line.raw.trimEnd())}`.slice(
            0,
            MAX_MESSAGE_LENGTH,
          );
        }
        skipped += 1;
        continue;
      }

      const parsed = parser.parse(line.raw, context);
      if (!parsed) {
        skipped += 1;
        continue;
      }

      entries.push({
        id: randomUUID(),
        applicationId: application.id,
        applicationType: application.type,
        server: dto.server,
        timestamp: parsed.timestamp,
        level: parsed.level,
        // Masquage **avant** persistance : une donnée de porteur écrite en clair
        // le reste dans le stockage et les sauvegardes (docs/SECURITY.md A09).
        message: this.sanitize(this.redaction.redact(parsed.message)),
        raw: this.redaction.redact(parsed.raw),
        metadata: this.redaction.redactMetadata(parsed.metadata),
      });
    }

    if (entries.length === 0) {
      return { accepted: 0, skipped };
    }

    await this.logStore.write(entries);

    // `lastLogAt` alimente la règle `silence` : sans cette mise à jour, un
    // agent qui émet normalement serait signalé muet.
    const latest = entries.reduce(
      (max, entry) => (entry.timestamp > max ? entry.timestamp : max),
      entries[0]!.timestamp,
    );
    await this.applications.touchLastLogAt(application.id, new Date(latest));

    const payload: LogIngestedEvent = { applicationId: application.id, entries };
    this.events.emit(INTERNAL_EVENTS.logIngested, payload);

    // Évaluation en streaming lancée sans attendre : la réponse à l'agent ne
    // dépend pas du moteur de règles.
    void this.alerting
      .evaluateApplication(application.id, 'streaming')
      .catch((error: unknown) =>
        this.logger.error(
          `Évaluation en streaming de ${application.name} en échec : ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );

    return { accepted: entries.length, skipped };
  }

  /**
   * Neutralise les caractères de contrôle et les séquences ANSI.
   *
   * Une ligne de log est du contenu hostile par nature : elle vient d'un système
   * tiers et peut avoir été forgée. Sans ce nettoyage, un retour chariot injecté
   * permettrait de falsifier l'affichage des entrées voisines
   * (docs/SECURITY.md A03, injection de log).
   */
  private sanitize(message: string): string {
    return message.replace(ANSI_ESCAPE, '').replace(CONTROL_CHARS, '').slice(0, MAX_MESSAGE_LENGTH);
  }
}
