import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { clampZeroBasedPagination } from '@/common/dto/pagination.helper';
import { BusinessError } from '@/common/errors/business-error';
import { AuthRuntimeRegistry } from '@/modules/auth';
import { FeatureResolutionService } from '@/modules/feature-tier';
import { TenantService } from '@/modules/tenant';
import {
  TenantContextStorage,
  type ResolvedTenantContext,
} from '@/modules/tenant';
import {
  PORTAL_TENANT_API_KEY_REPOSITORY_TOKEN,
  type IPortalTenantApiKeyRepository,
} from '../interfaces/portal-tenant-api-key-repository.interface';

interface BetterAuthApiKeyClient {
  createApiKey?: (opts: {
    body: {
      name?: string;
      prefix?: string;
      userId: string;
      permissions?: Record<string, string[]>;
      rateLimitMax?: number;
      rateLimitTimeWindow?: number;
      rateLimitEnabled?: boolean;
      expiresIn?: number;
    };
  }) => Promise<{
    id: string;
    name?: string | null;
    prefix?: string | null;
    start?: string | null;
    key: string;
    rateLimitMax?: number | null;
    rateLimitTimeWindow?: number | null;
    enabled?: boolean | null;
    requestCount?: number | null;
    expiresAt?: Date | string | null;
    createdAt: Date | string;
  }>;
}

export interface PortalTenantApiKeyItem {
  id: string;
  tenantId: string;
  name: string;
  prefix: string;
  keyPreview: string;
  ownerEmail: string;
  scopes: string[];
  rateLimitMax: number;
  rateLimitWindow: number;
  enabled: boolean;
  requestCount: number;
  lastUsedAt?: string;
  expiresAt?: string;
  createdAt: string;
  plainApiKey?: string;
}

@Injectable()
export class PortalTenantApiKeysService {
  constructor(
    private readonly tenantService: TenantService,
    private readonly featureResolution: FeatureResolutionService,
    private readonly authRuntimeRegistry: AuthRuntimeRegistry,
    @Inject(PORTAL_TENANT_API_KEY_REPOSITORY_TOKEN)
    private readonly apiKeyRepo: IPortalTenantApiKeyRepository,
  ) {}

  private parseScopes(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as string[] | Record<string, string[]>;
      if (Array.isArray(parsed)) return parsed;
      return Object.entries(parsed).flatMap(([res, acts]) =>
        acts.map((a) => (res === 'general' ? a : `${res}:${a}`)),
      );
    } catch {
      return [];
    }
  }

  private toPermissionRecord(scopes: string[]): Record<string, string[]> {
    const record: Record<string, string[]> = {};
    for (const scope of scopes) {
      const [resource, action] = scope.includes(':')
        ? scope.split(':', 2)
        : ['general', scope];
      if (!record[resource]) record[resource] = [];
      record[resource].push(action);
    }
    return record;
  }

  private mapRow(
    row: {
      apiKey: {
        id: string;
        tenantId: string | null;
        name: string | null;
        prefix: string | null;
        start: string | null;
        rateLimitMax: number | null;
        rateLimitTimeWindow: number | null;
        enabled: boolean | null;
        requestCount: number | null;
        lastRequest: Date | null;
        expiresAt: Date | null;
        createdAt: Date;
        permissions: string | null;
        referenceId: string;
      };
      ownerEmail: string | null;
    },
    plainApiKey?: string,
  ): PortalTenantApiKeyItem {
    const prefix = row.apiKey.prefix ?? 'ak_';
    return {
      id: row.apiKey.id,
      tenantId: row.apiKey.tenantId ?? '',
      name: row.apiKey.name ?? 'API Key',
      prefix,
      keyPreview: `${row.apiKey.start ?? prefix}••••••`,
      ownerEmail: row.ownerEmail ?? row.apiKey.referenceId,
      scopes: this.parseScopes(row.apiKey.permissions),
      rateLimitMax: row.apiKey.rateLimitMax ?? 100,
      rateLimitWindow: Math.round((row.apiKey.rateLimitTimeWindow ?? 60000) / 1000),
      enabled: Boolean(row.apiKey.enabled),
      requestCount: row.apiKey.requestCount ?? 0,
      lastUsedAt: row.apiKey.lastRequest
        ? row.apiKey.lastRequest.toISOString()
        : undefined,
      expiresAt: row.apiKey.expiresAt
        ? row.apiKey.expiresAt.toISOString()
        : undefined,
      createdAt: row.apiKey.createdAt.toISOString(),
      ...(plainApiKey ? { plainApiKey } : {}),
    };
  }

  private async assertTenantApiKeyFeature(tenantId: string, tierId: string) {
    const resolved = await this.featureResolution.resolveForTenant(
      tenantId,
      tierId,
    );
    if (!resolved.configMap.apiKey?.enabled) {
      throw BusinessError.forbidden(
        'Fitur API Key tidak aktif pada tier atau konfigurasi tenant ini.',
        'FEATURE_UNAVAILABLE',
        { tenantId, feature: 'apiKey' },
      );
    }
    return resolved;
  }

  async listTenantApiKeys(
    tenantId: string,
    query: { page?: number; pageSize?: number; search?: string },
  ): Promise<{
    items: PortalTenantApiKeyItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    await this.assertTenantApiKeyFeature(tenantId, tenant.tierId);

    const paging = clampZeroBasedPagination(
      query.page ?? 0,
      query.pageSize ?? 10,
    );

    const { items, total } = await this.apiKeyRepo.listByTenantPaginated({
      tenantId,
      page: paging.page,
      pageSize: paging.pageSize,
      search: query.search,
    });

    return {
      items: items.map((row) => this.mapRow(row)),
      total,
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }

  async createTenantApiKey(
    tenantId: string,
    ownerUserId: string,
    input: {
      name: string;
      scopes?: string[];
      rateLimitMax?: number;
      expiresAt?: string;
    },
    ownerEmail?: string,
  ): Promise<PortalTenantApiKeyItem> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    const resolved = await this.assertTenantApiKeyFeature(
      tenantId,
      tenant.tierId,
    );

    const scopes = input.scopes?.length
      ? Array.from(new Set(input.scopes.map((s) => s.trim()).filter(Boolean)))
      : ['sessions:verify'];

    let expiresInSeconds: number | undefined;
    if (input.expiresAt) {
      const expiresAtMs = new Date(input.expiresAt).getTime();
      if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
        throw new BadRequestException(
          'expiresAt harus berupa tanggal ISO valid di masa depan.',
        );
      }
      expiresInSeconds = Math.max(
        1,
        Math.floor((expiresAtMs - Date.now()) / 1000),
      );
    }

    const ctx: ResolvedTenantContext = {
      tenantId,
      slug: tenant.slug,
      tierId: tenant.tierId,
      configVersion: resolved.configVersion,
      source: 'path',
    };

    const created = await TenantContextStorage.run(ctx, async () => {
      const auth = await this.authRuntimeRegistry.getForContext(ctx);
      const api = auth.api as unknown as BetterAuthApiKeyClient;
      if (typeof api.createApiKey !== 'function') {
        throw new BadRequestException(
          'Plugin API Key Better Auth belum aktif pada runtime tenant.',
        );
      }

      return api.createApiKey({
        body: {
          name: input.name,
          prefix: 'ak_live_',
          userId: ownerUserId,
          permissions: this.toPermissionRecord(scopes),
          rateLimitEnabled: true,
          rateLimitMax: input.rateLimitMax ?? 100,
          rateLimitTimeWindow: 60000,
          ...(expiresInSeconds !== undefined
            ? { expiresIn: expiresInSeconds }
            : {}),
        },
      });
    });

    const stored = await this.apiKeyRepo.findByTenantAndId(tenantId, created.id);
    if (!stored) {
      throw new NotFoundException(
        'API Key tenant gagal diverifikasi setelah pembuatan.',
      );
    }

    const prefix = created.prefix ?? 'ak_live_';
    const start = created.start ?? created.key.slice(0, prefix.length + 4);

    return {
      id: created.id,
      tenantId,
      name: created.name ?? input.name,
      prefix,
      keyPreview: `${start}••••••${created.key.slice(-4)}`,
      ownerEmail: ownerEmail ?? ownerUserId,
      scopes,
      rateLimitMax: created.rateLimitMax ?? input.rateLimitMax ?? 100,
      rateLimitWindow: Math.round((created.rateLimitTimeWindow ?? 60000) / 1000),
      enabled: Boolean(created.enabled ?? true),
      requestCount: created.requestCount ?? 0,
      expiresAt: created.expiresAt
        ? new Date(created.expiresAt).toISOString()
        : undefined,
      createdAt: new Date(created.createdAt).toISOString(),
      plainApiKey: created.key,
    };
  }

  async deleteTenantApiKey(tenantId: string, keyId: string): Promise<void> {
    const tenant = await this.tenantService.getTenantById(tenantId);
    await this.assertTenantApiKeyFeature(tenantId, tenant.tierId);

    const deleted = await this.apiKeyRepo.deleteByTenantAndId(tenantId, keyId);
    if (!deleted) {
      throw new NotFoundException('API Key tenant tidak ditemukan.');
    }
  }
}