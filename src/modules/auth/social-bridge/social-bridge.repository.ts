import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as crypto from 'node:crypto';
import { DRIZZLE } from '@/database/database.constants';
import * as schema from '@/database/schema';
import type { FeatureResolutionService } from '@/modules/feature-tier';
import type { BetterAuthFeatureId } from '../config/feature-catalog';

export const SOCIAL_BRIDGE_REPOSITORY_TOKEN = Symbol(
  'SOCIAL_BRIDGE_REPOSITORY_TOKEN',
);

export interface TenantOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ISocialBridgeRepository {
  findTenantCredentials(
    tenantId: string,
    provider: string,
  ): Promise<TenantOAuthCredentials | null>;
  findAccountByProvider(
    tenantId: string,
    provider: string,
    providerAccountId: string,
  ): Promise<{ id: string; userId: string } | null>;
  findUserByTenantEmail(
    tenantId: string,
    email: string,
  ): Promise<{ id: string; email: string; emailVerified: boolean } | null>;
  createUserWithAccount(input: {
    tenantId: string;
    email: string;
    name: string;
    emailVerified: boolean;
    provider: string;
    providerAccountId: string;
  }): Promise<{ userId: string; email: string }>;
  linkAccountToUser(input: {
    tenantId: string;
    userId: string;
    provider: string;
    providerAccountId: string;
  }): Promise<void>;
  createSession(input: {
    tenantId: string;
    userId: string;
    token: string;
    expiresAt: Date;
  }): Promise<{ id: string; token: string }>;
}

const PROVIDER_TO_FEATURE_ID: Record<string, BetterAuthFeatureId> = {
  google: 'socialGoogle',
  github: 'socialGithub',
  microsoft: 'socialMicrosoft',
  apple: 'socialApple',
  discord: 'socialDiscord',
  gitlab: 'socialGitlab',
  slack: 'socialSlack',
  linkedin: 'socialLinkedin',
  twitter: 'socialTwitter',
  figma: 'socialFigma',
  notion: 'socialNotion',
  linear: 'socialLinear',
  vercel: 'socialVercel',
};

@Injectable()
export class DrizzleSocialBridgeRepository implements ISocialBridgeRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: NodePgDatabase<typeof schema>,
    @Optional()
    private readonly moduleRef?: ModuleRef,
  ) {}

  async findTenantCredentials(
    tenantId: string,
    provider: string,
  ): Promise<TenantOAuthCredentials | null> {
    const featureId = PROVIDER_TO_FEATURE_ID[provider.toLowerCase()];
    if (!featureId || !this.moduleRef) {
      return null;
    }

    let resolver: FeatureResolutionService | undefined;
    try {
      resolver = this.moduleRef.get<FeatureResolutionService>(
        'FEATURE_RESOLUTION_SERVICE',
        { strict: false },
      );
    } catch {
      return null;
    }

    if (!resolver) {
      return null;
    }

    const resolved = await resolver.resolveForTenant(tenantId, null);
    const secrets = resolved.decryptedSecrets?.[featureId];
    if (!secrets?.clientId || !secrets?.clientSecret) {
      return null;
    }

    return {
      clientId: secrets.clientId,
      clientSecret: secrets.clientSecret,
    };
  }

  async findAccountByProvider(
    tenantId: string,
    provider: string,
    providerAccountId: string,
  ): Promise<{ id: string; userId: string } | null> {
    const [row] = await this.db
      .select({ id: schema.account.id, userId: schema.account.userId })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.tenantId, tenantId),
          eq(schema.account.providerId, provider),
          eq(schema.account.accountId, providerAccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findUserByTenantEmail(
    tenantId: string,
    email: string,
  ): Promise<{ id: string; email: string; emailVerified: boolean } | null> {
    const [row] = await this.db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        emailVerified: schema.user.emailVerified,
      })
      .from(schema.user)
      .where(
        and(eq(schema.user.tenantId, tenantId), eq(schema.user.email, email)),
      )
      .limit(1);
    return row ?? null;
  }

  async createUserWithAccount(input: {
    tenantId: string;
    email: string;
    name: string;
    emailVerified: boolean;
    provider: string;
    providerAccountId: string;
  }): Promise<{ userId: string; email: string }> {
    const userId = crypto.randomUUID();
    const accountId = crypto.randomUUID();

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.user).values({
        id: userId,
        tenantId: input.tenantId,
        email: input.email,
        name: input.name,
        emailVerified: input.emailVerified,
      });
      await tx.insert(schema.account).values({
        id: accountId,
        tenantId: input.tenantId,
        userId,
        providerId: input.provider,
        accountId: input.providerAccountId,
      });
    });

    return { userId, email: input.email };
  }

  async linkAccountToUser(input: {
    tenantId: string;
    userId: string;
    provider: string;
    providerAccountId: string;
  }): Promise<void> {
    await this.db.insert(schema.account).values({
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      providerId: input.provider,
      accountId: input.providerAccountId,
    });
  }

  async createSession(input: {
    tenantId: string;
    userId: string;
    token: string;
    expiresAt: Date;
  }): Promise<{ id: string; token: string }> {
    const id = crypto.randomUUID();
    await this.db.insert(schema.session).values({
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      token: input.token,
      expiresAt: input.expiresAt,
    });
    return { id, token: input.token };
  }
}
