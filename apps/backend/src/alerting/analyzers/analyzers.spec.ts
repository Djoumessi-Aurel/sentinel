import type { LogCountCriteria, LogStore } from '../../log-store/log-store.interface';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyzerRegistry } from './analyzer.registry';
import { LevelThresholdAnalyzer } from './level-threshold.analyzer';
import { PatternRateAnalyzer } from './pattern-rate.analyzer';
import { ServiceSilenceAnalyzer, ServiceStatusAnalyzer } from './service-status.analyzer';
import { SilenceAnalyzer } from './silence.analyzer';

const NOW = new Date('2026-09-03T12:00:00.000Z');

const context = (params: Record<string, unknown>) => ({
  applicationId: 'app-1',
  applicationType: 'spring-boot',
  ruleId: 'rule-1',
  ruleName: 'Règle de test',
  params,
  now: NOW,
});

/** LogStore factice : renvoie un compte selon les critères reçus. */
const fakeStore = (counter: (criteria: LogCountCriteria) => number): LogStore => ({
  kind: 'mysql',
  ensureReady: jest.fn(),
  write: jest.fn(),
  search: jest.fn(),
  count: jest.fn(async (criteria: LogCountCriteria) => counter(criteria)),
});

describe('LevelThresholdAnalyzer', () => {
  it('déclenche dès que le seuil est atteint', async () => {
    const analyzer = new LevelThresholdAnalyzer(fakeStore(() => 3));
    const result = await analyzer.evaluate(
      context({ level: 'ERROR', minCount: 1, window: '5m', severity: 'critical' }),
    );

    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('critical');
    expect(result.details).toMatchObject({ count: 3 });
  });

  it('ne déclenche pas sous le seuil', async () => {
    const analyzer = new LevelThresholdAnalyzer(fakeStore(() => 2));
    const result = await analyzer.evaluate(
      context({ level: 'ERROR', minCount: 5, window: '5m', severity: 'critical' }),
    );
    expect(result.triggered).toBe(false);
  });

  it('interroge le stockage sur la fenêtre demandée', async () => {
    const store = fakeStore(() => 0);
    await new LevelThresholdAnalyzer(store).evaluate(
      context({ level: 'WARN', minCount: 1, window: '15m', severity: 'warning' }),
    );

    const criteria = (store.count as jest.Mock).mock.calls[0][0] as LogCountCriteria;
    expect(criteria.level).toBe('WARN');
    expect(criteria.to).toEqual(NOW);
    expect(NOW.getTime() - criteria.from.getTime()).toBe(15 * 60_000);
  });

  it('refuse des paramètres mal formés', () => {
    const analyzer = new LevelThresholdAnalyzer(fakeStore(() => 0));
    expect(() => analyzer.validateParams({ level: 'ERROR', window: 'toujours' })).toThrow();
  });
});

describe('PatternRateAnalyzer', () => {
  const params = {
    successMatch: { field: 'metadata.smsType', equals: 'card', outcome: 'success' },
    failureMatch: { field: 'metadata.smsType', equals: 'card', outcome: 'failure' },
    window: '1d',
    threshold: 96,
    operator: 'lt' as const,
    severity: 'critical' as const,
    minSamples: 10,
  };

  const storeWith = (successes: number, failures: number): LogStore =>
    fakeStore((criteria) => (criteria.metadata?.['outcome'] === 'success' ? successes : failures));

  it('déclenche quand le taux passe sous le seuil', async () => {
    const analyzer = new PatternRateAnalyzer(storeWith(90, 10));
    const result = await analyzer.evaluate(context(params));

    expect(result.triggered).toBe(true);
    expect(result.details).toMatchObject({ rate: 90, successes: 90, failures: 10, total: 100 });
  });

  it('ne déclenche pas quand le taux respecte le seuil', async () => {
    const analyzer = new PatternRateAnalyzer(storeWith(97, 3));
    expect((await analyzer.evaluate(context(params))).triggered).toBe(false);
  });

  /**
   * Point clé : sur trois envois dont deux échecs, le taux tombe à 33 % et
   * déclencherait une alerte critique alors que l'échantillon ne permet rien de
   * conclure. Une alerte à laquelle on ne peut pas se fier est pire qu'aucune.
   */
  it('ne conclut pas sur un échantillon insuffisant', async () => {
    const analyzer = new PatternRateAnalyzer(storeWith(1, 2));
    const result = await analyzer.evaluate(context(params));

    expect(result.triggered).toBe(false);
    expect(result.message).toContain('Échantillon insuffisant');
  });

  it('n’est pas spécifique à distribcard : les mêmes paramètres servent aux codes HTTP', async () => {
    const store = fakeStore(() => 50);
    await new PatternRateAnalyzer(store).evaluate(
      context({
        ...params,
        successMatch: { field: 'metadata.statusClass', equals: '2xx', outcome: 'success' },
        failureMatch: { field: 'metadata.statusClass', equals: '5xx', outcome: 'failure' },
      }),
    );

    const criteria = (store.count as jest.Mock).mock.calls[0][0] as LogCountCriteria;
    expect(criteria.metadata).toEqual({ statusClass: '2xx', outcome: 'success' });
  });
});

describe('SilenceAnalyzer', () => {
  const prismaWith = (application: unknown): PrismaService =>
    ({ application: { findUnique: jest.fn(async () => application) } }) as unknown as PrismaService;

  it('déclenche au-delà du seuil de silence', async () => {
    const analyzer = new SilenceAnalyzer(
      prismaWith({ lastLogAt: new Date(NOW.getTime() - 30 * 60_000), createdAt: NOW }),
    );
    const result = await analyzer.evaluate(context({ maxSilence: '15m', severity: 'critical' }));

    expect(result.triggered).toBe(true);
    expect(result.details).toMatchObject({ silenceMinutes: 30 });
  });

  it('ne déclenche pas si des logs arrivent encore', async () => {
    const analyzer = new SilenceAnalyzer(
      prismaWith({ lastLogAt: new Date(NOW.getTime() - 60_000), createdAt: NOW }),
    );
    expect((await analyzer.evaluate(context({ maxSilence: '15m', severity: 'critical' }))).triggered).toBe(false);
  });

  /**
   * Une appli qui n'a jamais reçu de log est mesurée depuis sa création : sans
   * cela, une appli déclarée mais dont l'agent n'a jamais été installé resterait
   * indéfiniment « verte ».
   */
  it('mesure depuis la création quand aucun log n’a jamais été reçu', async () => {
    const analyzer = new SilenceAnalyzer(
      prismaWith({ lastLogAt: null, createdAt: new Date(NOW.getTime() - 60 * 60_000) }),
    );
    const result = await analyzer.evaluate(context({ maxSilence: '15m', severity: 'critical' }));

    expect(result.triggered).toBe(true);
    expect(result.message).toContain('création');
  });
});

describe('analyseurs de services', () => {
  const prismaWith = (service: unknown): PrismaService =>
    ({ monitoredService: { findUnique: jest.fn(async () => service) } }) as unknown as PrismaService;

  const statusParams = { monitoredServiceId: 'svc-1', expectedState: 'active', severity: 'critical' as const };

  it('déclenche quand le service n’est pas dans l’état attendu', async () => {
    const analyzer = new ServiceStatusAnalyzer(
      prismaWith({ name: 'mysqld.service', lastState: 'failed', lastCheckedAt: NOW, critical: true }),
    );
    const result = await analyzer.evaluate(context(statusParams));

    expect(result.triggered).toBe(true);
    expect(result.message).toContain('mysqld.service');
  });

  it('ne déclenche pas quand le service est actif', async () => {
    const analyzer = new ServiceStatusAnalyzer(
      prismaWith({ name: 'httpd.service', lastState: 'active', lastCheckedAt: NOW, critical: true }),
    );
    expect((await analyzer.evaluate(context(statusParams))).triggered).toBe(false);
  });

  /**
   * Aucune vérification reçue n'est une absence de donnée, pas une panne :
   * c'est `service-silence` qui doit s'en saisir. Confondre les deux produirait
   * une alerte « service arrêté » sur un service jamais encore interrogé.
   */
  it('ne conclut pas à une panne quand aucune vérification n’est arrivée', async () => {
    const analyzer = new ServiceStatusAnalyzer(
      prismaWith({ name: 'httpd.service', lastState: null, lastCheckedAt: null, critical: true }),
    );
    const result = await analyzer.evaluate(context(statusParams));

    expect(result.triggered).toBe(false);
    expect(result.message).toContain('Aucune vérification');
  });

  it('signale l’absence prolongée de vérification', async () => {
    const analyzer = new ServiceSilenceAnalyzer(
      prismaWith({
        name: 'httpd.service',
        lastCheckedAt: new Date(NOW.getTime() - 300_000),
        createdAt: NOW,
        checkInterval: 30,
      }),
    );
    const result = await analyzer.evaluate(
      context({ monitoredServiceId: 'svc-1', maxSilence: '70s', severity: 'critical' }),
    );

    expect(result.triggered).toBe(true);
    expect(result.message).toContain('injoignable');
  });
});

describe('AnalyzerRegistry', () => {
  const stub = (type: string) =>
    ({ type, mode: 'streaming' as const, validateParams: (p: unknown) => p as Record<string, unknown>, evaluate: jest.fn() });

  it('retourne l’analyseur enregistré', () => {
    const registry = new AnalyzerRegistry();
    registry.register(stub('level-threshold'));
    expect(registry.get('level-threshold').type).toBe('level-threshold');
  });

  /**
   * Pas de repli, contrairement au registre de parseurs : une règle dont le type
   * est inconnu doit être refusée, jamais évaluée par un analyseur approchant.
   */
  it('refuse un type inconnu au lieu de retomber sur un analyseur générique', () => {
    const registry = new AnalyzerRegistry();
    registry.register(stub('level-threshold'));
    expect(() => registry.get('inexistant')).toThrow(/inconnu/);
  });

  it('refuse un double enregistrement', () => {
    const registry = new AnalyzerRegistry();
    registry.register(stub('silence'));
    expect(() => registry.register(stub('silence'))).toThrow(/déjà enregistré/);
  });

  it('filtre par mode d’évaluation', () => {
    const registry = new AnalyzerRegistry();
    registry.register(stub('level-threshold'));
    registry.register({ ...stub('silence'), mode: 'scheduled' as const });

    expect(registry.listByMode('streaming').map((a) => a.type)).toEqual(['level-threshold']);
    expect(registry.listByMode('scheduled').map((a) => a.type)).toEqual(['silence']);
  });
});
