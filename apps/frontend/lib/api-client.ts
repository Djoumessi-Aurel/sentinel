import type {
  AlertEvent,
  AnalyzerResult,
  AnalyzerRule,
  AppConfig,
  Application,
  ApplicationServicesStatus,
  ApplicationSummary,
  CreateApplicationDto,
  CreateMonitoredServiceDto,
  CreateServerDto,
  CreatedApplication,
  GlobalConfig,
  ListAlertsQuery,
  MonitoredService,
  Paginated,
  SearchLogsQuery,
  Server,
  StoredLogEntry,
  UpdateAppConfigDto,
  UpdateGlobalConfigDto,
} from '@sentinel/shared-types';

/**
 * Client HTTP typé. Les types viennent de `packages/shared-types`, donc du même
 * fichier que celui qui valide les requêtes côté backend : un contrat ne peut
 * pas diverger entre les deux côtés sans que TypeScript le signale
 * (docs/API.md §9).
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '') + '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
  } catch {
    // Distinguer « backend injoignable » d'une erreur applicative : c'est la
    // première question que se pose l'utilisateur devant un écran vide.
    throw new ApiError(0, 'Backend injoignable. Est-il démarré sur ' + API_BASE + ' ?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text === '' ? null : JSON.parse(text);

  if (!response.ok) {
    const body = payload as { message?: string | string[]; errors?: Array<{ path: string; message: string }> } | null;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? 'Erreur inattendue');
    throw new ApiError(response.status, message, body?.errors);
  }

  return payload as T;
}

const toQuery = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
};

export const api = {
  health: () => request<{ status: string; database: boolean; logStore: string }>('/health'),

  servers: {
    list: () => request<Server[]>('/servers'),
    create: (dto: CreateServerDto) => request<Server>('/servers', { method: 'POST', body: JSON.stringify(dto) }),
  },

  applications: {
    list: () => request<ApplicationSummary[]>('/applications'),
    get: (id: string) => request<Application>(`/applications/${id}`),
    types: () => request<{ types: string[] }>('/applications/types'),
    create: (dto: CreateApplicationDto) =>
      request<CreatedApplication>('/applications', { method: 'POST', body: JSON.stringify(dto) }),
    remove: (id: string) => request<void>(`/applications/${id}`, { method: 'DELETE' }),
    issueToken: (id: string) => request<{ agentToken: string }>(`/applications/${id}/tokens`, { method: 'POST' }),
  },

  config: {
    getGlobal: () => request<GlobalConfig>('/config/global'),
    updateGlobal: (dto: UpdateGlobalConfigDto) =>
      request<GlobalConfig>('/config/global', { method: 'PATCH', body: JSON.stringify(dto) }),
    getApp: (appId: string) => request<AppConfig>(`/config/applications/${appId}`),
    updateApp: (appId: string, dto: UpdateAppConfigDto) =>
      request<AppConfig>(`/config/applications/${appId}`, { method: 'PATCH', body: JSON.stringify(dto) }),
    generalize: (applicationIds: string[]) =>
      request<{ updated: string[] }>('/config/generalize', {
        method: 'POST',
        body: JSON.stringify({ applicationIds }),
      }),
  },

  rules: {
    list: (appId: string) => request<AnalyzerRule[]>(`/applications/${appId}/rules`),
    types: () => request<{ types: string[] }>('/rules/types'),
    setEnabled: (ruleId: string, enabled: boolean) =>
      request<AnalyzerRule>(`/rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    test: (ruleId: string) => request<AnalyzerResult>(`/rules/${ruleId}/test`, { method: 'POST' }),
    remove: (ruleId: string) => request<void>(`/rules/${ruleId}`, { method: 'DELETE' }),
  },

  services: {
    list: (appId: string) => request<MonitoredService[]>(`/applications/${appId}/services`),
    status: (appId: string) => request<ApplicationServicesStatus>(`/applications/${appId}/services/status`),
    create: (appId: string, dto: CreateMonitoredServiceDto) =>
      request<MonitoredService>(`/applications/${appId}/services`, { method: 'POST', body: JSON.stringify(dto) }),
    remove: (serviceId: string) => request<void>(`/services/${serviceId}`, { method: 'DELETE' }),
  },

  alerts: {
    list: (query: Partial<ListAlertsQuery> = {}) =>
      request<Paginated<AlertEvent>>(`/alerts${toQuery(query as Record<string, string | number | undefined>)}`),
    resolve: (alertId: string) => request<AlertEvent>(`/alerts/${alertId}/resolve`, { method: 'PATCH' }),
    testChannel: (applicationId: string, channel: 'visual' | 'sound' | 'email' | 'sms') =>
      request<{ status: string; detail?: string }>('/alerts/test-channel', {
        method: 'POST',
        body: JSON.stringify({ applicationId, channel }),
      }),
  },

  retention: {
    purge: () =>
      request<{ status: 'ok' | 'busy'; report: { logs: number; resolvedAlerts: number; serviceEvents: number } | null }>(
        '/retention/purge',
        { method: 'POST' },
      ),
  },

  logs: {
    search: (query: Partial<SearchLogsQuery>) =>
      request<Paginated<StoredLogEntry>>(`/logs${toQuery(query as Record<string, string | number | undefined>)}`),
  },
};
