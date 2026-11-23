import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ConsoleActor,
  type IPlatformSessionRepository,
  type ListSessionsQuery,
  PLATFORM_SESSION_REPOSITORY_TOKEN,
} from '../interfaces';
import { PlatformAuditService } from './platform-audit.service';

@Injectable()
export class PlatformSessionsService {
  constructor(
    @Inject(PLATFORM_SESSION_REPOSITORY_TOKEN)
    private readonly sessionRepo: IPlatformSessionRepository,
    private readonly auditService: PlatformAuditService,
  ) {}

  private inferDeviceType(ua: string): 'Desktop' | 'Mobile' | 'CLI' | 'API' {
    if (/mobile|android|iphone/i.test(ua)) return 'Mobile';
    if (/curl|cli|httpie/i.test(ua)) return 'CLI';
    if (/node|fetch|axios/i.test(ua)) return 'API';
    return 'Desktop';
  }

  async listSessions(query: ListSessionsQuery) {
    const { items, total } = await this.sessionRepo.listPaginated(query);
    const now = Date.now();

    return {
      items: items.map((r) => {
        const ua = r.userAgent ?? 'Unknown Client';
        return {
          id: r.id,
          userId: r.userId,
          userName: r.userName,
          userEmail: r.userEmail,
          tokenPreview:
            r.token.length > 10
              ? `${r.token.slice(0, 6)}••••${r.token.slice(-4)}`
              : '••••',
          ipAddress: r.ipAddress ?? '127.0.0.1',
          userAgent: ua,
          deviceType: this.inferDeviceType(ua),
          location: 'Local Network',
          impersonatedBy: r.impersonatedBy ?? undefined,
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          active: r.expiresAt.getTime() > now,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async revokeSession(sessionId: string, actor: ConsoleActor): Promise<void> {
    const target = await this.sessionRepo.findById(sessionId);
    if (!target) {
      throw new NotFoundException('Sesi tidak ditemukan.');
    }

    await this.sessionRepo.deleteById(sessionId);

    await this.auditService.recordAudit({
      event: 'session.revoked',
      category: 'auth',
      severity: 'warning',
      actor,
      target: `session/${sessionId}`,
      metadata: { userId: target.userId },
    });
  }

  async revokeInactiveSessions(): Promise<number> {
    return this.sessionRepo.deleteExpired();
  }
}
