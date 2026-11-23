import { Inject, Injectable } from '@nestjs/common';
import type { AuditTrailLog } from '@/database/schema';
import { AuthFeatureConfigService } from '@/modules/auth';
import { normalizeCursorPagination } from '../dto/pagination.util';
import {
  type ConsoleActor,
  type IPlatformAuditRepository,
  type ListAuditLogsQuery,
  PLATFORM_AUDIT_REPOSITORY_TOKEN,
} from '../interfaces';

export function mapAuditLogRow(row: AuditTrailLog) {
  return {
    id: row.id,
    event: row.action,
    category: (row.category || row.moduleKey || 'auth') as
      'auth' | 'admin' | 'rbac' | 'organization' | 'api-key' | 'config',
    severity: (row.severity || 'info') as 'info' | 'warning' | 'critical',
    actorEmail: row.actorEmail ?? 'system@authcore.io',
    actorRole: row.actorRole ?? 'system',
    target: row.target ?? `${row.entityType}/${row.entityId}`,
    ipAddress: row.ipAddress ?? '127.0.0.1',
    userAgent: row.userAgent ?? 'AuthCoreAPI',
    createdAt: row.createdAt.toISOString(),
    metadata: (row.metadata ?? {}) as Record<string, string | number | boolean>,
  };
}

@Injectable()
export class PlatformAuditService {
  constructor(
    @Inject(PLATFORM_AUDIT_REPOSITORY_TOKEN)
    private readonly auditRepo: IPlatformAuditRepository,
    private readonly featureConfigService: AuthFeatureConfigService,
  ) {}

  async recordAudit(input: {
    event: string;
    category: string;
    severity: 'info' | 'warning' | 'critical';
    actor?: ConsoleActor;
    target: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.featureConfigService.isFeatureEnabled('auditLogs')) return;

    await this.auditRepo.create({
      moduleKey: input.category,
      actorId: input.actor?.id ?? null,
      category: input.category,
      severity: input.severity,
      actorEmail: input.actor?.email ?? 'system@authcore.io',
      actorRole: input.actor?.role ?? 'system',
      target: input.target,
      ipAddress: '127.0.0.1',
      userAgent: 'AuthCoreAPI',
      action: input.event,
      entityType: input.category,
      entityId: input.target,
      metadata: input.metadata ?? {},
    });
  }

  async fetchAuditLogsPage(query: ListAuditLogsQuery) {
    this.featureConfigService.assertFeatureEnabled('auditLogs');

    const { cursor, limit } = normalizeCursorPagination(
      query.cursor,
      query.limit,
    );
    const { items, total } = await this.auditRepo.listPaginated({
      ...query,
      cursor,
      limit,
    });
    const end = cursor + limit;

    return {
      items: items.map(mapAuditLogRow),
      nextCursor: end < total ? end : null,
      totalCount: total,
    };
  }
}
