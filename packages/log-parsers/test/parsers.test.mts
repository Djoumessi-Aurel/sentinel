import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  distribcardParser,
  genericParser,
  nodePm2Parser,
  parserRegistry,
  reactNginxParser,
  springBootParser,
} from '../dist/index.js';
import type { ParseContext } from '../dist/types.js';

const ctx: ParseContext = { applicationId: 'app-1', server: 'srv-1' };
/** Les serveurs du GIE sont en UTC+1. */
const ctxUtcPlus1: ParseContext = { ...ctx, sourceUtcOffsetMinutes: 60 };

describe('ParserRegistry', () => {
  it('retourne le parseur du type demandé', () => {
    assert.equal(parserRegistry.get('spring-boot').appType, 'spring-boot');
    assert.equal(parserRegistry.get('distribcard').appType, 'distribcard');
  });

  it('retombe sur le parseur générique pour un type inconnu, sans lever', () => {
    assert.equal(parserRegistry.get('type-jamais-vu').appType, 'generic');
  });

  it('expose la liste des types enregistrés', () => {
    const types = parserRegistry.listTypes();
    assert.ok(types.includes('spring-boot'));
    assert.ok(types.includes('react-nginx'));
    assert.ok(types.includes('nodejs-pm2'));
  });
});

describe('GenericParser', () => {
  it('détecte le niveau par mot isolé', () => {
    const entry = genericParser.parse('quelque chose a ERROR pendant le traitement', ctx);
    assert.equal(entry?.level, 'ERROR');
  });

  it('ne confond pas un mot contenant un niveau avec le niveau lui-même', () => {
    const entry = genericParser.parse('compteur ERRORS_TOTAL=0', ctx);
    assert.equal(entry?.level, 'UNKNOWN');
  });

  it('normalise WARNING en WARN', () => {
    assert.equal(genericParser.parse('WARNING disque plein', ctx)?.level, 'WARN');
  });

  it('ignore les lignes vides', () => {
    assert.equal(genericParser.parse('   ', ctx), null);
  });
});

describe('SpringBootParser', () => {
  it('extrait horodatage, niveau, thread, logger et message', () => {
    const line = '2026-03-13 10:15:32.123  INFO 12345 --- [main] c.example.Service : traitement terminé';
    const entry = springBootParser.parse(line, ctx);

    assert.equal(entry?.timestamp, '2026-03-13T10:15:32.123Z');
    assert.equal(entry?.level, 'INFO');
    assert.equal(entry?.message, 'traitement terminé');
    assert.equal(entry?.metadata?.['thread'], 'main');
    assert.equal(entry?.metadata?.['logger'], 'c.example.Service');
    assert.equal(entry?.raw, line);
  });

  it('gère le séparateur tiret sans le bloc pid', () => {
    const entry = springBootParser.parse('2026-03-13 10:15:32 ERROR [pool-1] c.e.Job - échec du job', ctx);
    assert.equal(entry?.level, 'ERROR');
    assert.equal(entry?.message, 'échec du job');
  });

  it('convertit un horodatage local UTC+1 vers UTC', () => {
    const entry = springBootParser.parse('2026-03-13 10:15:32.000 INFO [main] c.E : ok', ctxUtcPlus1);
    assert.equal(entry?.timestamp, '2026-03-13T09:15:32.000Z');
  });

  it('reconnaît une ligne de stack trace comme continuation', () => {
    assert.equal(springBootParser.isContinuation('\tat com.example.Service.run(Service.java:42)'), true);
    assert.equal(springBootParser.isContinuation('2026-03-13 10:15:32 INFO [main] c.E - ok'), false);
    assert.equal(springBootParser.isContinuation('   '), false);
  });

  it('conserve une ligne hors format plutôt que de la perdre', () => {
    const entry = springBootParser.parse('  ::: Spring Boot :::  ', ctx);
    assert.ok(entry);
    assert.equal(entry?.message, '::: Spring Boot :::');
  });
});

describe('DistribcardParser', () => {
  const line = (message: string) => `2026-03-13 10:15:32.000  INFO 1 --- [main] c.g.Sched : ${message}`;

  it('qualifie un succès de SMS carte', () => {
    const entry = distribcardParser.parse(line('Notification envoyée avec succès pour la commande de carte 123'), ctx);
    assert.equal(entry?.metadata?.['smsType'], 'card');
    assert.equal(entry?.metadata?.['outcome'], 'success');
  });

  it('qualifie un échec de SMS carte', () => {
    const entry = distribcardParser.parse(line('SMS not sent for card availability'), ctx);
    assert.equal(entry?.metadata?.['smsType'], 'card');
    assert.equal(entry?.metadata?.['outcome'], 'failure');
  });

  it('qualifie succès et échec de SMS pin', () => {
    const ok = distribcardParser.parse(line('Notification envoyée avec succès pour la commande de code'), ctx);
    assert.equal(ok?.metadata?.['smsType'], 'pin');
    assert.equal(ok?.metadata?.['outcome'], 'success');

    const ko = distribcardParser.parse(line('pin availability notification scheduler failed'), ctx);
    assert.equal(ko?.metadata?.['smsType'], 'pin');
    assert.equal(ko?.metadata?.['outcome'], 'failure');
  });

  it('laisse les lignes sans motif métier sans qualification', () => {
    const entry = distribcardParser.parse(line('démarrage du scheduler'), ctx);
    assert.equal(entry?.metadata?.['outcome'], undefined);
  });

  it('conserve le parsing Spring Boot hérité', () => {
    const entry = distribcardParser.parse(line('SMS not sent for pin availability'), ctx);
    assert.equal(entry?.level, 'INFO');
    assert.equal(entry?.metadata?.['thread'], 'main');
  });
});

describe('NodePm2Parser', () => {
  it('parse un log JSON structuré', () => {
    const line = '{"level":"error","message":"connexion refusée","timestamp":"2026-03-13T10:15:32.000Z","attempt":3}';
    const entry = nodePm2Parser.parse(line, ctx);

    assert.equal(entry?.level, 'ERROR');
    assert.equal(entry?.message, 'connexion refusée');
    assert.equal(entry?.timestamp, '2026-03-13T10:15:32.000Z');
    assert.equal(entry?.metadata?.['attempt'], 3);
  });

  it('gère le format pino (niveau numérique, time epoch)', () => {
    const entry = nodePm2Parser.parse('{"level":50,"msg":"boom","time":1773396932000}', ctx);
    assert.equal(entry?.level, 'ERROR');
    assert.equal(entry?.message, 'boom');
  });

  it('retombe sur la détection texte pour du JSON invalide', () => {
    const entry = nodePm2Parser.parse('{ceci n\'est pas du json, ERROR}', ctx);
    assert.equal(entry?.level, 'ERROR');
  });

  it('retombe sur la détection texte pour une ligne libre', () => {
    const entry = nodePm2Parser.parse('2026-03-13 10:15:32 warn: cache vide', ctx);
    assert.equal(entry?.level, 'WARN');
    assert.equal(entry?.timestamp, '2026-03-13T10:15:32.000Z');
  });
});

describe('ReactNginxParser', () => {
  it('parse une ligne error.log', () => {
    const entry = reactNginxParser.parse(
      '2026/03/13 10:15:32 [error] 1234#0: *1 connect() failed upstream',
      ctxUtcPlus1,
    );
    assert.equal(entry?.level, 'ERROR');
    assert.equal(entry?.timestamp, '2026-03-13T09:15:32.000Z');
    assert.equal(entry?.metadata?.['source'], 'error.log');
  });

  it('mappe les sévérités nginx hautes sur FATAL', () => {
    const entry = reactNginxParser.parse('2026/03/13 10:15:32 [crit] 1#0: disque plein', ctx);
    assert.equal(entry?.level, 'FATAL');
  });

  it('parse une ligne access.log et en extrait le code HTTP', () => {
    const line =
      '10.11.40.87 - - [13/Mar/2026:10:15:32 +0100] "GET /api/tpe HTTP/1.1" 502 137 "-" "Mozilla/5.0"';
    const entry = reactNginxParser.parse(line, ctx);

    assert.equal(entry?.level, 'ERROR');
    assert.equal(entry?.metadata?.['status'], 502);
    assert.equal(entry?.metadata?.['statusClass'], '5xx');
    assert.equal(entry?.metadata?.['method'], 'GET');
    assert.equal(entry?.metadata?.['path'], '/api/tpe');
    // +0100 converti en UTC
    assert.equal(entry?.timestamp, '2026-03-13T09:15:32.000Z');
  });

  it('classe un 4xx en WARN et un 2xx en INFO', () => {
    const base = (status: number) =>
      `10.0.0.1 - - [13/Mar/2026:10:15:32 +0100] "GET / HTTP/1.1" ${status} 10 "-" "-"`;
    assert.equal(reactNginxParser.parse(base(404), ctx)?.level, 'WARN');
    assert.equal(reactNginxParser.parse(base(200), ctx)?.level, 'INFO');
  });
});
