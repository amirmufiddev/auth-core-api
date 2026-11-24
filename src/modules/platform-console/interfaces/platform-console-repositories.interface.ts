import type { AuditTrailLog, Passkey, Session, User } from '@/database/schema';

export interface ConsoleActor {
  id: string;
  email: string;
  role: string;
}

export interface ListUsersQuery {
  page: number;
  pageSize: number;
  search?: string;
  role?: string;
  status?: string;
  sortBy?: string;
  sortDir?: string;
  scope?: "platform" | "all";
}

export interface CreatePlatformUserRecord {
  id: string;
  accountId: string;
  name: string;
  email: string;
  username: string;
  role: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  passwordHash: string;
}

export interface UserProfileRelations {
  accounts: Array<{ providerId: string }>;
  passkeys: Passkey[];
  organizationName?: string;
}

export interface PlatformUserDashboardStats {
  totalUsers: number;
  bannedUsers: number;
  twoFactorUsers: number;
  authMethodDistribution: Array<{ method: string; count: number }>;
}

export interface ListSessionsQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  sinceDate?: string;
}

export interface SessionWithUserRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  impersonatedBy: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface DailyTrendCount {
  day: string;
  count: number;
}

export interface ListAuditLogsQuery {
  cursor: number;
  limit: number;
  search?: string;
  severity?: string;
  category?: string;
  fromDate?: string;
  toDate?: string;
}

export interface CreatePlatformAuditRecord {
  moduleKey: string;
  actorId: string | null;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  actorEmail: string;
  actorRole: string;
  target: string;
  ipAddress: string;
  userAgent: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}

export const PLATFORM_USER_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_USER_REPOSITORY_TOKEN',
);
export const PLATFORM_SESSION_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_SESSION_REPOSITORY_TOKEN',
);
export const PLATFORM_AUDIT_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_AUDIT_REPOSITORY_TOKEN',
);

export interface IPlatformUserRepository {
  listPaginated(
    query: ListUsersQuery,
  ): Promise<{ items: User[]; total: number }>;
  findPlatformById(id: string): Promise<User | null>;
  findPlatformByEmail(email: string): Promise<User | null>;
  createPlatformUser(input: CreatePlatformUserRecord): Promise<User>;
  updatePlatformUser(id: string, patch: Partial<User>): Promise<User>;
  deletePlatformUser(id: string): Promise<void>;
  getProfileRelations(userId: string): Promise<UserProfileRelations>;
  getPasskeyCounts(userIds: string[]): Promise<Map<string, number>>;
  getPrimaryOrgNames(userIds: string[]): Promise<Map<string, string>>;
  getDashboardStats(): Promise<PlatformUserDashboardStats>;
  getUserCountsByRole(): Promise<Map<string, number>>;
}

export interface IPlatformSessionRepository {
  listPaginated(
    query: ListSessionsQuery,
  ): Promise<{ items: SessionWithUserRow[]; total: number }>;
  findById(id: string): Promise<Session | null>;
  deleteById(id: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
  deleteExpired(): Promise<number>;
  countActive(): Promise<number>;
  countCreatedByDay(since: Date): Promise<DailyTrendCount[]>;
}

export interface IPlatformAuditRepository {
  create(input: CreatePlatformAuditRecord): Promise<void>;
  listPaginated(
    query: ListAuditLogsQuery,
  ): Promise<{ items: AuditTrailLog[]; total: number }>;
  listRecent(limit: number): Promise<AuditTrailLog[]>;
  countSince(since: Date): Promise<number>;
  countCreatedByDay(since: Date): Promise<DailyTrendCount[]>;
}
