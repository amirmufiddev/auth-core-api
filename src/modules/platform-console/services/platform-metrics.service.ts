import { Inject, Injectable } from '@nestjs/common';
import {
  type IPlatformAuditRepository,
  type IPlatformSessionRepository,
  type IPlatformUserRepository,
  PLATFORM_AUDIT_REPOSITORY_TOKEN,
  PLATFORM_SESSION_REPOSITORY_TOKEN,
  PLATFORM_USER_REPOSITORY_TOKEN,
} from '../interfaces';
import { mapAuditLogRow } from './platform-audit.service';

@Injectable()
export class PlatformMetricsService {
  constructor(
    @Inject(PLATFORM_USER_REPOSITORY_TOKEN)
    private readonly userRepo: IPlatformUserRepository,
    @Inject(PLATFORM_SESSION_REPOSITORY_TOKEN)
    private readonly sessionRepo: IPlatformSessionRepository,
    @Inject(PLATFORM_AUDIT_REPOSITORY_TOKEN)
    private readonly auditRepo: IPlatformAuditRepository,
  ) {}

  async getDashboardMetrics() {
    const now = Date.now();
    const since24h = new Date(now - 86400 * 1000);
    const fourteenDaysAgo = new Date(now - 13 * 86400000);
    fourteenDaysAgo.setHours(0, 0, 0, 0);

    const [
      userStats,
      activeSessions,
      authEvents24h,
      sessionDaily,
      auditDaily,
      recentLogs,
    ] = await Promise.all([
      this.userRepo.getDashboardStats(),
      this.sessionRepo.countActive(),
      this.auditRepo.countSince(since24h),
      this.sessionRepo.countCreatedByDay(fourteenDaysAgo),
      this.auditRepo.countCreatedByDay(fourteenDaysAgo),
      this.auditRepo.listRecent(6),
    ]);

    const sessionMap = new Map(sessionDaily.map((d) => [d.day, d.count]));
    const auditMap = new Map(auditDaily.map((d) => [d.day, d.count]));

    const signInTrend = Array.from({ length: 14 }, (_, idx) => {
      const dayStart = new Date(now - (13 - idx) * 86400000);
      dayStart.setHours(0, 0, 0, 0);
      const isoDay = dayStart.toISOString().slice(0, 10);
      const totalDay =
        (sessionMap.get(isoDay) ?? 0) + (auditMap.get(isoDay) ?? 0);

      return {
        date: dayStart.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
        }),
        signIns: totalDay,
        tokensIssued: totalDay * 2,
      };
    });

    return {
      totalUsers: userStats.totalUsers,
      activeSessions,
      bannedUsers: userStats.bannedUsers,
      twoFactorAdoption: Math.round(
        (userStats.twoFactorUsers / Math.max(1, userStats.totalUsers)) * 100,
      ),
      authEvents24h,
      signInTrend,
      authMethodDistribution: userStats.authMethodDistribution,
      recentEvents: recentLogs.map(mapAuditLogRow),
    };
  }
}
