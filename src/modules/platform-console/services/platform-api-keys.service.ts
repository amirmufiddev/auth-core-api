import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { AuthFeatureConfigService } from '@/modules/auth';
import type { CreateApiKeyDto } from '../dto/platform-console.dto';
import {
  type ConsoleActor,
  type IPlatformApiKeyRepository,
  type IPlatformUserRepository,
  type PaginatedSearchQuery,
  PLATFORM_API_KEY_REPOSITORY_TOKEN,
  PLATFORM_USER_REPOSITORY_TOKEN,
} from '../interfaces';
import { PlatformAuditService } from './platform-audit.service';

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

@Injectable()
export class PlatformApiKeysService {
  constructor(
    @Inject(PLATFORM_API_KEY_REPOSITORY_TOKEN)
    private readonly apiKeyRepo: IPlatformApiKeyRepository,
    @Inject(PLATFORM_USER_REPOSITORY_TOKEN)
    private readonly userRepo: IPlatformUserRepository,
    private readonly authService: AuthService,
    private readonly featureConfigService: AuthFeatureConfigService,
    private readonly auditService: PlatformAuditService,
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

  async listApiKeys(query: PaginatedSearchQuery) {
    this.featureConfigService.assertFeatureEnabled('apiKey');

    const { items, total } = await this.apiKeyRepo.listPaginated(query);

    return {
      items: items.map(({ apiKey: k, ownerEmail }) => {
        const prefix = k.prefix ?? 'ak_';
        return {
          id: k.id,
          name: k.name ?? 'API Key',
          prefix,
          keyPreview: `${k.start ?? prefix}••••••`,
          ownerEmail: ownerEmail ?? k.referenceId,
          scopes: this.parseScopes(k.permissions),
          rateLimitMax: k.rateLimitMax ?? 100,
          rateLimitWindow: Math.round((k.rateLimitTimeWindow ?? 60000) / 1000),
          enabled: Boolean(k.enabled),
          requestCount: k.requestCount ?? 0,
          lastUsedAt: k.lastRequest ? k.lastRequest.toISOString() : undefined,
          expiresAt: k.expiresAt ? k.expiresAt.toISOString() : undefined,
          createdAt: k.createdAt.toISOString(),
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createApiKey(input: CreateApiKeyDto, actor: ConsoleActor) {
    this.featureConfigService.assertFeatureEnabled('apiKey');

    const owner = await this.userRepo.findPlatformByEmail(input.ownerEmail);
    if (!owner) {
      throw new NotFoundException(
        `Pengguna platform dengan email '${input.ownerEmail}' tidak ditemukan.`,
      );
    }
    const referenceId = owner.id;

    const api = this.authService.api as unknown as BetterAuthApiKeyClient;
    if (typeof api.createApiKey !== 'function') {
      throw new BadRequestException(
        'Plugin API Key Better Auth belum aktif pada runtime.',
      );
    }

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

    const created = await api.createApiKey({
      body: {
        name: input.name,
        prefix: input.prefix || undefined,
        userId: referenceId,
        permissions: this.toPermissionRecord(input.scopes),
        rateLimitEnabled: true,
        rateLimitMax: input.rateLimitMax,
        rateLimitTimeWindow: 60000,
        ...(expiresInSeconds !== undefined
          ? { expiresIn: expiresInSeconds }
          : {}),
      },
    });

    await this.auditService.recordAudit({
      event: 'api_key.created',
      category: 'api-key',
      severity: 'info',
      actor,
      target: `key/${input.name}`,
      metadata: { scopes: input.scopes.join(',') },
    });

    const prefix = created.prefix ?? input.prefix;
    const start = created.start ?? created.key.slice(0, prefix.length + 4);
    const createdAtIso = new Date(created.createdAt).toISOString();
    const expiresAtIso = created.expiresAt
      ? new Date(created.expiresAt).toISOString()
      : undefined;

    return {
      record: {
        id: created.id,
        name: created.name ?? input.name,
        prefix,
        keyPreview: `${start}••••••${created.key.slice(-4)}`,
        ownerEmail: owner?.email ?? input.ownerEmail,
        scopes: input.scopes,
        rateLimitMax: created.rateLimitMax ?? input.rateLimitMax,
        rateLimitWindow: Math.round(
          (created.rateLimitTimeWindow ?? 60000) / 1000,
        ),
        enabled: Boolean(created.enabled ?? true),
        requestCount: created.requestCount ?? 0,
        expiresAt: expiresAtIso,
        createdAt: createdAtIso,
      },
      plainSecret: created.key,
    };
  }

  async toggleApiKey(keyId: string, enabled: boolean): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('apiKey');
    await this.apiKeyRepo.updateEnabled(keyId, enabled);
  }

  async deleteApiKey(keyId: string, actor: ConsoleActor): Promise<void> {
    this.featureConfigService.assertFeatureEnabled('apiKey');

    const target = await this.apiKeyRepo.findById(keyId);
    if (!target) {
      throw new NotFoundException('API Key tidak ditemukan.');
    }

    await this.apiKeyRepo.deleteById(keyId);

    await this.auditService.recordAudit({
      event: 'api_key.revoked',
      category: 'api-key',
      severity: 'warning',
      actor,
      target: `key/${target.name ?? keyId}`,
      metadata: { keyId },
    });
  }
}
