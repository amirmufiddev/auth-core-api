import * as crypto from 'node:crypto';
import * as schema from '@/database/schema';
import { APIError, betterAuth, type BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { prepareWhatsappNumber } from '@/common/phone/phone.util';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createAccessControl } from 'better-auth/plugins/access';
import {
  BOOTSTRAP_BETTER_AUTH_STATEMENT,
  getDefaultRolePermissions,
  getDefaultPermissionScopes,
} from '@/modules/rbac/constants/permissions.constant';
import { loadOrganizationRoleTemplates } from '@/modules/rbac/permissions/rbac-permission.loader';
import {
  admin,
  anonymous,
  bearer,
  captcha,
  deviceAuthorization,
  emailOTP,
  genericOAuth,
  haveIBeenPwned,
  jwt,
  lastLoginMethod,
  magicLink,
  multiSession,
  oAuthProxy,
  oneTap,
  oneTimeToken,
  openAPI,
  organization,
  phoneNumber,
  siwe,
  twoFactor,
  username,
} from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { apiKey } from '@better-auth/api-key';
import { sso } from '@better-auth/sso';
import { scim } from '@better-auth/scim';
import { oauthProvider } from '@better-auth/oauth-provider';
import { mcp } from '@better-auth/mcp';
import { stripe } from '@better-auth/stripe';
import { i18n } from '@better-auth/i18n';
import { MemberAcceptedBridge } from '@/modules/member';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { canCreateOrganization } from '@/modules/auth/organization-access';
import translationsId from '@/i18n/id/auth-errors.json';
import translationsEn from '@/i18n/en/auth-errors.json';
import { getSharedPool } from '@/database/database.module';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@/logger/logger.service';
import {
  EmailService,
  buildResetPasswordEmail,
  buildEmailVerificationEmail,
  buildOrganizationInvitationEmail,
} from '@/modules/email';
import { AppConfig, AuthConfig } from '@/config';
import { buildInvitationLink } from '@/modules/auth/invitation-link.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type BetterAuthFeatureId,
  type FeatureConfigMap,
  buildDefaultFeatureConfigFromEnv,
} from './config/feature-catalog';
import { type ResolvedTenantContext } from '@/modules/tenant';
import {
  createTenantDatabaseHooks,
  createTenantMultiTenantPlugins,
  getEffectiveTenantContext,
  resolveTenantCookieConfig,
} from './multi-tenant/tenant-auth-hooks';

export type AgentAuthPluginFactory = (options: {
  providerName: string;
  providerDescription?: string;
  modes?: Array<'delegated' | 'autonomous'>;
  capabilities?: Array<{ name: string; description: string }>;
}) => unknown;

export interface AuditLogInput {
  tenantId?: string | null;
  action: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  target: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuthDependencies {
  configService: ConfigService;
  emailService?: EmailService;
  loggerService?: AppLoggerService;
  secondaryStorage?: BetterAuthOptions['secondaryStorage'];
  database?: BetterAuthOptions['database'];
  tenantContext?: ResolvedTenantContext | null;
  tenantStatus?: 'active' | 'suspended';
  eventEmitter?: EventEmitter2;
  betterAuthStatement?: Record<string, readonly string[]>;
  featureConfig?: FeatureConfigMap;
  agentAuthPluginFactory?: AgentAuthPluginFactory;
  auditLogger?: (entry: AuditLogInput) => Promise<void>;
}

function isEnabled(
  featureConfig: FeatureConfigMap | undefined,
  id: BetterAuthFeatureId,
  fallback: boolean,
): boolean {
  if (!featureConfig) return fallback;
  return Boolean(featureConfig[id]?.enabled);
}

function getSetting<T extends string | number | boolean>(
  featureConfig: FeatureConfigMap | undefined,
  id: BetterAuthFeatureId,
  key: string,
  fallback: T,
): T {
  const val = featureConfig?.[id]?.settings?.[key];
  if (val === undefined || val === null || val === '') return fallback;
  return val as T;
}

const buildEmailAndPasswordConfig = (deps: AuthDependencies) => {
  const fc = deps.featureConfig;
  const enabled = isEnabled(fc, 'emailAndPassword', true);
  const minPasswordLength = Number(
    getSetting(fc, 'emailAndPassword', 'minPasswordLength', 8),
  );
  const maxPasswordLength = Number(
    getSetting(fc, 'emailAndPassword', 'maxPasswordLength', 128),
  );
  const autoSignIn = Boolean(
    getSetting(fc, 'emailAndPassword', 'autoSignIn', true),
  );
  const requireEmailVerification = Boolean(
    getSetting(fc, 'emailAndPassword', 'requireEmailVerification', false),
  );

  return {
    enabled,
    minPasswordLength,
    maxPasswordLength,
    autoSignIn,
    requireEmailVerification,
    async sendResetPassword({
      user,
      url,
    }: {
      user: { name?: string | null; email?: string };
      url: string;
    }) {
      const { appName } = deps.configService.get<AppConfig>('app', {
        infer: true,
      });
      if (!deps.emailService || !user.email) return;
      const html = buildResetPasswordEmail({
        userName: user.name ?? 'Pengguna',
        resetUrl: url,
        appName,
      });
      await deps.emailService.send({
        to: user.email,
        subject: `[${appName}] Reset Kata Sandi Akun Anda`,
        html,
      });
    },
    password: {
      hash: async (password: string) => {
        const argon2 = await import('argon2');
        return await argon2.hash(password);
      },
      verify: async ({
        password,
        hash,
      }: {
        password: string;
        hash: string;
      }) => {
        const argon2 = await import('argon2');
        return await argon2.verify(hash, password);
      },
    },
  };
};

const buildEmailVerificationConfig = (deps: AuthDependencies) => {
  const fc = deps.featureConfig;
  const enabled = isEnabled(fc, 'emailVerification', true);
  if (!enabled) {
    return undefined;
  }

  return {
    sendOnSignUp: Boolean(
      getSetting(fc, 'emailVerification', 'sendOnSignUp', true),
    ),
    autoSignInAfterVerification: Boolean(
      getSetting(fc, 'emailVerification', 'autoSignInAfterVerification', true),
    ),
    expiresIn: Number(getSetting(fc, 'emailVerification', 'expiresIn', 3600)),
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { name?: string | null; email?: string };
      url: string;
    }) => {
      const { appName } = deps.configService.get<AppConfig>('app', {
        infer: true,
      });
      if (!deps.emailService || !user.email) return;
      const html = buildEmailVerificationEmail({
        userName: user.name ?? 'Pengguna',
        verificationUrl: url,
        appName,
      });
      await deps.emailService.send({
        to: user.email,
        subject: `[${appName}] Verifikasi Alamat Email Anda`,
        html,
      });
    },
  };
};

const SOCIAL_PROVIDER_ENV_MAP: Array<{
  featureId: BetterAuthFeatureId;
  providerKey: string;
  envPrefix: string;
}> = [
  { featureId: 'socialGoogle', providerKey: 'google', envPrefix: 'GOOGLE' },
  { featureId: 'socialGithub', providerKey: 'github', envPrefix: 'GITHUB' },
  {
    featureId: 'socialMicrosoft',
    providerKey: 'microsoft',
    envPrefix: 'MICROSOFT',
  },
  { featureId: 'socialApple', providerKey: 'apple', envPrefix: 'APPLE' },
  { featureId: 'socialDiscord', providerKey: 'discord', envPrefix: 'DISCORD' },
  { featureId: 'socialGitlab', providerKey: 'gitlab', envPrefix: 'GITLAB' },
  { featureId: 'socialSlack', providerKey: 'slack', envPrefix: 'SLACK' },
  {
    featureId: 'socialLinkedin',
    providerKey: 'linkedin',
    envPrefix: 'LINKEDIN',
  },
  { featureId: 'socialTwitter', providerKey: 'twitter', envPrefix: 'TWITTER' },
  { featureId: 'socialFigma', providerKey: 'figma', envPrefix: 'FIGMA' },
  { featureId: 'socialNotion', providerKey: 'notion', envPrefix: 'NOTION' },
  { featureId: 'socialLinear', providerKey: 'linear', envPrefix: 'LINEAR' },
  { featureId: 'socialVercel', providerKey: 'vercel', envPrefix: 'VERCEL' },
];

const buildSocialProvidersConfig = (
  deps: AuthDependencies,
  googleClientId: string,
  googleClientSecret: string,
) => {
  const fc = deps.featureConfig;
  if (!fc) {
    return {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        enabled: !!(googleClientId && googleClientSecret),
      },
    };
  }

  const providers: Record<string, Record<string, unknown>> = {};
  for (const entry of SOCIAL_PROVIDER_ENV_MAP) {
    if (!isEnabled(fc, entry.featureId, false)) continue;
    const clientIdFromSetting = String(
      getSetting(fc, entry.featureId, 'clientId', ''),
    );
    const clientId =
      entry.providerKey === 'google'
        ? googleClientId || clientIdFromSetting
        : process.env[`${entry.envPrefix}_CLIENT_ID`] || clientIdFromSetting;
    const clientSecret =
      entry.providerKey === 'google'
        ? googleClientSecret
        : process.env[`${entry.envPrefix}_CLIENT_SECRET`] || '';

    if (clientId && clientSecret) {
      providers[entry.providerKey] = {
        clientId,
        clientSecret,
        enabled: true,
      };
    }
  }
  return providers;
};

const buildPaymentPlugins = (deps: AuthDependencies): unknown[] => {
  const fc = deps.featureConfig;
  if (!fc) return [];
  const paymentPlugins: unknown[] = [];

  if (isEnabled(fc, 'stripe', false) && process.env.STRIPE_SECRET_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Stripe = require('stripe');
      const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
      paymentPlugins.push(
        stripe({
          stripeClient,
          stripeWebhookSecret:
            process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder',
          createCustomerOnSignUp: Boolean(
            getSetting(fc, 'stripe', 'createCustomerOnSignUp', true),
          ),
        }),
      );
    } catch (error) {
      deps.loggerService?.warn(
        `Plugin stripe dilewati: ${error instanceof Error ? error.message : String(error)}`,
        'Auth',
      );
    }
  }

  if (isEnabled(fc, 'polar', false) && process.env.POLAR_ACCESS_TOKEN) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { polar } = require('@polar-sh/better-auth');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Polar } = require('@polar-sh/sdk');
      const polarClient = new Polar({
        accessToken: process.env.POLAR_ACCESS_TOKEN,
        server: String(getSetting(fc, 'polar', 'environment', 'sandbox')) as
          'sandbox' | 'production',
      });
      paymentPlugins.push(
        polar({
          client: polarClient,
          createCustomerOnSignUp: false,
          use: [],
        }),
      );
    } catch (error) {
      deps.loggerService?.warn(
        `Plugin polar dilewati: ${error instanceof Error ? error.message : String(error)}`,
        'Auth',
      );
    }
  }

  if (
    isEnabled(fc, 'dodoPayments', false) &&
    process.env.DODO_PAYMENTS_API_KEY
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dodopayments } = require('@dodopayments/better-auth');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const DodoPayments = require('dodopayments').default;
      const client = new DodoPayments({
        bearerToken: process.env.DODO_PAYMENTS_API_KEY,
        environment: String(
          getSetting(fc, 'dodoPayments', 'environment', 'test_mode'),
        ),
      });
      paymentPlugins.push(
        dodopayments({
          client,
          createCustomerOnSignUp: false,
          use: [],
        }),
      );
    } catch (error) {
      deps.loggerService?.warn(
        `Plugin dodoPayments dilewati: ${error instanceof Error ? error.message : String(error)}`,
        'Auth',
      );
    }
  }

  if (isEnabled(fc, 'creem', false) && process.env.CREEM_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { creem } = require('@creem_io/better-auth');
      paymentPlugins.push(
        creem({
          apiKey: process.env.CREEM_API_KEY,
          webhookSecret: process.env.CREEM_WEBHOOK_SECRET || 'creem_whsec',
          testMode: Boolean(getSetting(fc, 'creem', 'testMode', true)),
        }),
      );
    } catch (error) {
      deps.loggerService?.warn(
        `Plugin creem dilewati: ${error instanceof Error ? error.message : String(error)}`,
        'Auth',
      );
    }
  }

  if (isEnabled(fc, 'chargebee', false) && process.env.CHARGEBEE_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { chargebee } = require('@chargebee/better-auth');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Chargebee = require('chargebee');
      const site =
        process.env.CHARGEBEE_SITE ||
        String(getSetting(fc, 'chargebee', 'site', 'authcore-test'));
      const cbClient = new Chargebee({
        site,
        apiKey: process.env.CHARGEBEE_API_KEY,
      });
      paymentPlugins.push(chargebee({ client: cbClient }));
    } catch (error) {
      deps.loggerService?.warn(
        `Plugin chargebee dilewati: ${error instanceof Error ? error.message : String(error)}`,
        'Auth',
      );
    }
  }

  return paymentPlugins;
};

const buildPluginsConfig = (
  deps: AuthDependencies,
  authDb: ReturnType<typeof drizzle>,
): unknown[] => {
  const { appName, fallbackLanguage, baseUrl } =
    deps.configService.get<AppConfig>('app', {
      infer: true,
    });
  const {
    membershipLimit,
    organizationLimit,
    invitationExpiresIn,
    inviteURL,
    clientUrl,
    secret,
  } = deps.configService.get<AuthConfig>('auth', {
    infer: true,
  });

  const fc = deps.featureConfig;
  const statement = deps.betterAuthStatement ?? BOOTSTRAP_BETTER_AUTH_STATEMENT;
  const ac = createAccessControl(statement);
  const fullStatementRole = ac.newRole({
    ...Object.fromEntries(
      Object.keys(statement).map((key) => [key, statement[key]]),
    ),
  });

  const pluginsList: unknown[] = [];
  const hasApiKey = Boolean(fc && isEnabled(fc, 'apiKey', false));
  const hasDeviceAuth = Boolean(
    fc && isEnabled(fc, 'deviceAuthorization', false),
  );
  const hasTwoFactor = isEnabled(fc, 'twoFactor', true);
  const hasPasskey = Boolean(fc && isEnabled(fc, 'passkey', false));
  const hasOAuthProvider = Boolean(
    fc &&
    (isEnabled(fc, 'mcp', false) || isEnabled(fc, 'oauthProvider', false)),
  );

  // Register multi-tenant & OAuth 2.1 cross-tenant guards BEFORE bearer/oauthProvider
  // so tenant context, suspended checks, and client ownership run first.
  pluginsList.push(
    ...createTenantMultiTenantPlugins({
      staticTenantContext: deps.tenantContext,
      tenantStatus: deps.tenantStatus,
      enabledPlugins: {
        twoFactor: hasTwoFactor,
        passkey: hasPasskey,
        apiKey: hasApiKey,
        deviceAuthorization: hasDeviceAuth,
        oauthProvider: hasOAuthProvider,
      },
    }),
  );

  if (isEnabled(fc, 'bearer', true)) {
    pluginsList.push(
      bearer({
        requireSignature: Boolean(
          getSetting(fc, 'bearer', 'requireSignature', false),
        ),
      }),
    );
  }

  if (isEnabled(fc, 'admin', true)) {
    const adminRolesStr = String(
      getSetting(fc, 'admin', 'adminRoles', 'super_admin,admin'),
    );
    const adminRoles = adminRolesStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    pluginsList.push(
      admin({
        ac,
        defaultRole: String(getSetting(fc, 'admin', 'defaultRole', 'user')),
        adminRoles:
          adminRoles.length > 0 ? adminRoles : ['super_admin', 'admin'],
        impersonationSessionDuration: Number(
          getSetting(fc, 'admin', 'impersonationSessionDuration', 3600),
        ),
        roles: {
          super_admin: fullStatementRole,
          admin: fullStatementRole,
          user: ac.newRole({}),
        },
      }),
    );
  }

  if (isEnabled(fc, 'username', true)) {
    pluginsList.push(
      username({
        minUsernameLength: Number(
          getSetting(fc, 'username', 'minUsernameLength', 3),
        ),
        maxUsernameLength: Number(
          getSetting(fc, 'username', 'maxUsernameLength', 30),
        ),
      }),
    );
  }

  if (isEnabled(fc, 'phoneNumber', fc ? false : true)) {
    pluginsList.push(
      phoneNumber({
        otpLength: Number(getSetting(fc, 'phoneNumber', 'otpLength', 6)),
        expiresIn: Number(getSetting(fc, 'phoneNumber', 'expiresIn', 300)),
        phoneNumberValidator: (value) => prepareWhatsappNumber(value, true).ok,
        sendOTP: ({ phoneNumber: target, code }) => {
          const nodeEnv = deps.configService.get<AppConfig>('app', {
            infer: true,
          }).nodeEnv;
          deps.loggerService?.log(
            nodeEnv === 'production'
              ? `Kode verifikasi WhatsApp diminta untuk ${target}`
              : `Kode verifikasi WhatsApp untuk ${target}: ${code}`,
            'Auth',
          );
          return Promise.resolve();
        },
        callbackOnVerification: async ({ user }, ctx) => {
          const current = ctx?.context.session;
          if (!ctx || !current) return;
          await setSessionCookie(ctx, {
            session: current.session,
            user,
          });
        },
      }),
    );
  }

  if (isEnabled(fc, 'twoFactor', true)) {
    pluginsList.push(
      twoFactor({
        issuer: String(getSetting(fc, 'twoFactor', 'issuer', appName)),
        totpOptions: {
          digits: Number(getSetting(fc, 'twoFactor', 'totpDigits', '6')) as
            6 | 8,
        },
        backupCodeOptions: {
          amount: Number(getSetting(fc, 'twoFactor', 'backupCodeAmount', 10)),
        },
      }),
    );
  }

  if (fc && isEnabled(fc, 'passkey', false)) {
    let parsedOrigin = clientUrl || 'http://localhost:2000';
    let parsedRpId = 'localhost';
    try {
      const u = new URL(parsedOrigin);
      parsedRpId = u.hostname;
    } catch {
      parsedOrigin = 'http://localhost:2000';
    }
    pluginsList.push(
      passkey({
        rpID: String(getSetting(fc, 'passkey', 'rpID', parsedRpId)),
        rpName: String(getSetting(fc, 'passkey', 'rpName', appName)),
        origin: parsedOrigin,
      }),
    );
  }

  if (fc && isEnabled(fc, 'magicLink', false)) {
    pluginsList.push(
      magicLink({
        expiresIn: Number(getSetting(fc, 'magicLink', 'expiresIn', 300)),
        disableSignUp: Boolean(
          getSetting(fc, 'magicLink', 'disableSignUp', false),
        ),
        sendMagicLink: async ({ email, url }) => {
          deps.loggerService?.log(`Magic link untuk ${email}: ${url}`, 'Auth');
          if (!deps.emailService) return;
          await deps.emailService.send({
            to: email,
            subject: `[${appName}] Tautan Masuk Sekali Pakai`,
            html: `<p>Klik tautan berikut untuk masuk ke ${appName}:</p><p><a href="${url}">${url}</a></p>`,
          });
        },
      }),
    );
  }

  if (fc && isEnabled(fc, 'emailOTP', false)) {
    pluginsList.push(
      emailOTP({
        otpLength: Number(getSetting(fc, 'emailOTP', 'otpLength', 6)),
        expiresIn: Number(getSetting(fc, 'emailOTP', 'expiresIn', 300)),
        allowedAttempts: Number(
          getSetting(fc, 'emailOTP', 'allowedAttempts', 3),
        ),
        sendVerificationOTP: async ({ email, otp, type }) => {
          deps.loggerService?.log(
            `Email OTP (${type}) untuk ${email}: ${otp}`,
            'Auth',
          );
          if (!deps.emailService) return;
          await deps.emailService.send({
            to: email,
            subject: `[${appName}] Kode OTP Verifikasi Anda`,
            html: `<p>Kode OTP (${type}) Anda: <strong>${otp}</strong></p>`,
          });
        },
      }),
    );
  }

  if (fc && isEnabled(fc, 'anonymous', false)) {
    pluginsList.push(
      anonymous({
        emailDomainName: String(
          getSetting(
            fc,
            'anonymous',
            'emailDomainName',
            'guest.authcore.local',
          ),
        ),
        disableDeleteAnonymousUser: Boolean(
          getSetting(fc, 'anonymous', 'disableDeleteAnonymousUser', false),
        ),
      }),
    );
  }

  if (fc && isEnabled(fc, 'oneTap', false)) {
    const oneTapClientId = String(
      getSetting(fc, 'oneTap', 'clientId', process.env.GOOGLE_CLIENT_ID || ''),
    );
    if (oneTapClientId) {
      pluginsList.push(
        oneTap({
          clientId: oneTapClientId,
          disableSignup: Boolean(
            getSetting(fc, 'oneTap', 'disableSignup', false),
          ),
        }),
      );
    }
  }

  if (fc && isEnabled(fc, 'siwe', false)) {
    pluginsList.push(
      siwe({
        domain: String(getSetting(fc, 'siwe', 'domain', 'authcore.local')),
        anonymous: Boolean(getSetting(fc, 'siwe', 'anonymous', true)),
        getNonce: () => Promise.resolve(crypto.randomBytes(16).toString('hex')),
        verifyMessage: () => Promise.resolve(false),
      }),
    );
  }

  if (fc && isEnabled(fc, 'genericOAuth', false)) {
    const providerId = String(
      getSetting(fc, 'genericOAuth', 'providerId', 'keycloak'),
    );
    const discoveryUrl = String(
      getSetting(fc, 'genericOAuth', 'discoveryUrl', ''),
    );
    const gClientId = String(getSetting(fc, 'genericOAuth', 'clientId', ''));
    if (discoveryUrl && gClientId) {
      pluginsList.push(
        genericOAuth({
          config: [
            {
              providerId,
              discoveryUrl,
              clientId: gClientId,
              clientSecret: process.env.GENERIC_OAUTH_CLIENT_SECRET || '',
            },
          ],
        }),
      );
    }
  }

  if (isEnabled(fc, 'organization', true)) {
    const teamsEnabled = Boolean(
      getSetting(fc, 'organization', 'teamsEnabled', true),
    );
    pluginsList.push(
      organization({
        ac,
        allowUserToCreateOrganization: async (user) => {
          const rows = await authDb
            .select({ role: schema.member.role })
            .from(schema.member)
            .where(eq(schema.member.userId, user.id));
          return canCreateOrganization(rows.map((row) => row.role));
        },
        organizationLimit: Number(
          getSetting(
            fc,
            'organization',
            'organizationLimit',
            organizationLimit ?? 5,
          ),
        ),
        creatorRole: 'owner',
        membershipLimit,
        invitationExpiresIn: Number(
          getSetting(
            fc,
            'organization',
            'invitationExpiresIn',
            invitationExpiresIn ?? 172800,
          ),
        ),
        teams: {
          enabled: teamsEnabled,
        },
        dynamicAccessControl: {
          enabled: true,
        },
        schema: {
          organization: {
            additionalFields: {
              tenantId: {
                type: 'string',
                required: true,
              },
            },
          },
          organizationRole: {
            additionalFields: {
              permissionScopes: {
                type: 'string',
                defaultValue: '{}',
              },
            },
          },
        },
        organizationHooks: {
          afterAcceptInvitation: async ({ member, user, organization }) => {
            deps.eventEmitter?.emit('rbac.cache.invalidate', {
              orgId: organization.id,
              userId: user.id,
            });
            await MemberAcceptedBridge.handler?.({
              organizationId: organization.id,
              userId: user.id,
              email: user.email,
              name: user.name,
              phone: user.phoneNumber ?? null,
              role: member.role,
            });
          },
          afterAddMember: async ({ member, user, organization }) => {
            deps.eventEmitter?.emit('rbac.cache.invalidate', {
              orgId: organization.id,
              userId: user.id,
            });
            await MemberAcceptedBridge.handler?.({
              organizationId: organization.id,
              userId: user.id,
              email: user.email,
              name: user.name,
              phone: user.phoneNumber ?? null,
              role: member.role,
            });
          },
          afterCreateOrganization: async ({ organization }) => {
            const templates = await loadOrganizationRoleTemplates(authDb);

            const roleEntries =
              templates.length > 0
                ? templates.map((template) => ({
                    id: crypto.randomUUID(),
                    organizationId: organization.id,
                    role: template.roleName,
                    permission: template.permission,
                    permissionScopes: template.permissionScopes,
                    createdAt: new Date(),
                  }))
                : Object.entries(getDefaultRolePermissions()).map(
                    ([role, permissions]) => ({
                      id: crypto.randomUUID(),
                      organizationId: organization.id,
                      role,
                      permission: JSON.stringify(permissions),
                      permissionScopes: JSON.stringify(
                        getDefaultPermissionScopes()[role] ?? {},
                      ),
                      createdAt: new Date(),
                    }),
                  );

            await authDb
              .insert(schema.organizationRole)
              .values(roleEntries)
              .onConflictDoNothing();

            deps.loggerService?.log(
              `Created default roles for organization ${organization.id}: ${roleEntries.map((entry) => entry.role).join(', ')}`,
            );
          },
        },
        async sendInvitationEmail(data) {
          if (!deps.emailService) return;

          const inviteUrl = buildInvitationLink({
            invitationId: data.id,
            inviteURL,
          });
          const html = buildOrganizationInvitationEmail({
            inviterName: data.inviter.user.name ?? data.inviter.user.email,
            organizationName: data.organization.name,
            organizationLogo: data.organization.logo,
            role: data.role,
            inviteUrl,
            appName,
            baseUrl,
          });
          await deps.emailService.send({
            to: data.email,
            subject: `[${appName}] Undangan Bergabung dengan Organisasi ${data.organization.name}`,
            html,
          });
        },
      }),
    );
  }

  if (fc && isEnabled(fc, 'apiKey', false)) {
    pluginsList.push(
      apiKey({
        defaultPrefix: String(
          getSetting(fc, 'apiKey', 'defaultPrefix', 'ak_live_'),
        ),
        defaultKeyLength: Number(
          getSetting(fc, 'apiKey', 'defaultKeyLength', 48),
        ),
        enableMetadata: Boolean(
          getSetting(fc, 'apiKey', 'enableMetadata', true),
        ),
        rateLimit: {
          enabled: Boolean(getSetting(fc, 'apiKey', 'rateLimitEnabled', true)),
        },
      }),
    );
  }

  if (fc && isEnabled(fc, 'agentAuth', false) && deps.agentAuthPluginFactory) {
    try {
      pluginsList.push(
        deps.agentAuthPluginFactory({
          providerName: appName,
          providerDescription: `${appName} AI Agent Authorization Service`,
          modes: ['delegated', 'autonomous'],
          capabilities: [],
        }),
      );
    } catch (error) {
      deps.loggerService?.warn(
        `Plugin agentAuth dilewati: ${error instanceof Error ? error.message : String(error)}`,
        'Auth',
      );
    }
  }

  const jwtActive = fc
    ? isEnabled(fc, 'jwt', false) ||
      isEnabled(fc, 'oauthProvider', false) ||
      isEnabled(fc, 'mcp', false)
    : false;
  const oauthOrMcpActive = fc
    ? isEnabled(fc, 'oauthProvider', false) || isEnabled(fc, 'mcp', false)
    : false;

  if (jwtActive) {
    const alg = String(getSetting(fc, 'jwt', 'algorithm', 'EdDSA')) as
      'EdDSA' | 'RS256' | 'ES256';
    pluginsList.push(
      jwt({
        disableSettingJwtHeader: oauthOrMcpActive,
        jwks: {
          keyPairConfig:
            alg === 'EdDSA' ? { alg: 'EdDSA', crv: 'Ed25519' } : { alg },
        },
        jwt: {
          expirationTime: String(
            getSetting(fc, 'jwt', 'expirationTime', '15m'),
          ),
        },
      }),
    );
  }

  // @better-auth/mcp wraps oauthProvider internally and forbids duplicate registration.
  if (fc && isEnabled(fc, 'mcp', false)) {
    pluginsList.push(
      mcp({
        loginPage: String(getSetting(fc, 'mcp', 'loginPage', '/login')),
        consentPage: '/consent',
        resource: String(getSetting(fc, 'mcp', 'resource', `${baseUrl}/mcp`)),
      }),
    );
  } else if (fc && isEnabled(fc, 'oauthProvider', false)) {
    pluginsList.push(
      oauthProvider({
        loginPage: '/login',
        consentPage: '/consent',
        accessTokenExpiresIn: Number(
          getSetting(fc, 'oauthProvider', 'accessTokenExpiresIn', 3600),
        ),
        refreshTokenExpiresIn: Number(
          getSetting(fc, 'oauthProvider', 'refreshTokenExpiresIn', 2592000),
        ),
        allowDynamicClientRegistration: Boolean(
          getSetting(
            fc,
            'oauthProvider',
            'allowDynamicClientRegistration',
            false,
          ),
        ),
      }),
    );
  }

  if (fc && isEnabled(fc, 'deviceAuthorization', false)) {
    pluginsList.push(
      deviceAuthorization({
        expiresIn: `${Number(getSetting(fc, 'deviceAuthorization', 'expiresIn', 600))}s`,
        interval: `${Number(getSetting(fc, 'deviceAuthorization', 'interval', 5))}s`,
      }),
    );
  }

  if (fc && isEnabled(fc, 'sso', false)) {
    pluginsList.push(
      sso({
        domainVerification: {
          enabled: Boolean(getSetting(fc, 'sso', 'domainVerification', true)),
        },
      }),
    );
  }

  if (fc && isEnabled(fc, 'scim', false)) {
    const hashSecret =
      secret && secret.length >= 32
        ? secret
        : 'authcore-scim-hmac-secret-minimum-32-chars';
    pluginsList.push(
      scim({
        connections: [],
        managedConnections: {
          credentialHashSecret: hashSecret,
        },
      }),
    );
  }

  if (fc && isEnabled(fc, 'multiSession', false)) {
    pluginsList.push(
      multiSession({
        maximumSessions: Number(
          getSetting(fc, 'multiSession', 'maximumSessions', 5),
        ),
      }),
    );
  }

  if (fc && isEnabled(fc, 'captcha', false)) {
    const captchaSecret = process.env.CAPTCHA_SECRET_KEY;
    if (captchaSecret) {
      pluginsList.push(
        captcha({
          provider: String(
            getSetting(fc, 'captcha', 'provider', 'cloudflare-turnstile'),
          ) as 'cloudflare-turnstile' | 'google-recaptcha' | 'hcaptcha',
          secretKey: captchaSecret,
        }),
      );
    }
  }

  if (fc && isEnabled(fc, 'haveIBeenPwned', false)) {
    pluginsList.push(
      haveIBeenPwned({
        customPasswordCompromisedMessage: String(
          getSetting(
            fc,
            'haveIBeenPwned',
            'customPasswordCompromisedMessage',
            'Kata sandi terdeteksi dalam kebocoran data publik.',
          ),
        ),
      }),
    );
  }

  if (fc && isEnabled(fc, 'lastLoginMethod', false)) {
    pluginsList.push(
      lastLoginMethod({
        storeInDatabase: true,
        cookieName: String(
          getSetting(
            fc,
            'lastLoginMethod',
            'cookieName',
            'authcore.last_used_login_method',
          ),
        ),
        maxAge: Number(getSetting(fc, 'lastLoginMethod', 'maxAge', 2592000)),
      }),
    );
  }

  if (fc && isEnabled(fc, 'oneTimeToken', false)) {
    pluginsList.push(
      oneTimeToken({
        expiresIn: Number(getSetting(fc, 'oneTimeToken', 'expiresIn', 3)),
      }),
    );
  }

  if (fc && isEnabled(fc, 'oauthProxy', false)) {
    const currentURL = String(getSetting(fc, 'oauthProxy', 'currentURL', ''));
    const productionURL = String(
      getSetting(fc, 'oauthProxy', 'productionURL', ''),
    );
    if (productionURL) {
      pluginsList.push(
        oAuthProxy({
          ...(currentURL ? { currentURL } : {}),
          productionURL,
        }),
      );
    }
  }

  if (isEnabled(fc, 'openAPI', true)) {
    pluginsList.push(
      openAPI({
        path: String(getSetting(fc, 'openAPI', 'path', '/reference')),
        disableDefaultReference: Boolean(
          getSetting(fc, 'openAPI', 'disableDefaultReference', false),
        ),
      }),
    );
  }

  if (isEnabled(fc, 'i18n', true)) {
    pluginsList.push(
      i18n({
        defaultLocale: String(
          getSetting(fc, 'i18n', 'defaultLocale', fallbackLanguage ?? 'id'),
        ),
        detection: ['header', 'cookie'],
        localeCookie: 'locale',
        translations: {
          id: translationsId,
          en: translationsEn,
        },
      }),
    );
  }

  pluginsList.push(...buildPaymentPlugins(deps));

  return pluginsList;
};

function assignWhatsappNumber(
  user: Record<string, unknown>,
  required: boolean,
): void {
  const result = prepareWhatsappNumber(user.phoneNumber, required);
  if (result.ok === false) {
    throw new APIError('BAD_REQUEST', {
      message:
        result.reason === 'required'
          ? 'Nomor WhatsApp wajib diisi'
          : 'Nomor WhatsApp tidak valid',
    });
  }
  if (result.value) {
    user.phoneNumber = result.value;
  }
}

export const createAuthInstance = (deps: AuthDependencies) => {
  const { corsOrigins, appName } = deps.configService.get<AppConfig>('app', {
    infer: true,
  });
  const { url, secret, path, google, useSecureCookies, errorURL, session } =
    deps.configService.get<AuthConfig>('auth', {
      infer: true,
    });

  const authDb = drizzle({ client: getSharedPool(), schema: schema as any });
  const fc = deps.featureConfig;
  const emailVerificationCfg = buildEmailVerificationConfig(deps);

  const trustedProvidersRaw = String(
    getSetting(fc, 'accountLinking', 'trustedProviders', 'google,github'),
  );
  const trustedProviders = trustedProvidersRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const sessionExpiresIn = Number(
    getSetting(
      fc,
      'sessionManagement',
      'expiresIn',
      session.expiresIn ?? 604800,
    ),
  );
  const sessionUpdateAge = Number(
    getSetting(
      fc,
      'sessionManagement',
      'updateAge',
      session.updateAge ?? 86400,
    ),
  );
  const cookieCacheEnabled = Boolean(
    getSetting(
      fc,
      'sessionManagement',
      'cookieCacheEnabled',
      session.cookieCache?.enabled ?? true,
    ),
  );
  const cookieCacheMaxAge = Number(
    getSetting(
      fc,
      'sessionManagement',
      'cookieCacheMaxAge',
      session.cookieCache?.maxAge ?? 300,
    ),
  );

  const cookieConfig = resolveTenantCookieConfig(deps.tenantContext);

  const options: BetterAuthOptions = {
    appName,
    basePath: path,
    baseURL: url,
    secret,
    database:
      deps.database ?? drizzleAdapter(authDb, { provider: 'pg', schema }),
    secondaryStorage: deps.secondaryStorage,
    verification: {
      storeInDatabase: true,
    },
    user: {
      additionalFields: {
        phoneNumber: {
          type: 'string',
          required: false,
          defaultValue: null,
          input: true,
        },
      },
    },
    emailAndPassword: buildEmailAndPasswordConfig(deps),
    ...(emailVerificationCfg
      ? { emailVerification: emailVerificationCfg }
      : {}),
    socialProviders: buildSocialProvidersConfig(
      deps,
      google.clientId,
      google.clientSecret,
    ),
    account: {
      accountLinking: {
        enabled:
          isEnabled(fc, 'accountLinking', true) &&
          Boolean(getSetting(fc, 'accountLinking', 'enabled', true)),
        trustedProviders:
          trustedProviders.length > 0 ? trustedProviders : ['google'],
        allowDifferentEmails: Boolean(
          getSetting(fc, 'accountLinking', 'allowDifferentEmails', false),
        ),
        requireLocalEmailVerified: false,
      },
    },
    session: {
      expiresIn: sessionExpiresIn,
      updateAge: sessionUpdateAge,
      storeSessionInDatabase: true,
      cookieCache: {
        enabled: cookieCacheEnabled,
        maxAge: cookieCacheMaxAge,
      },
    },
    ...(fc
      ? {
          rateLimit: {
            enabled: isEnabled(fc, 'rateLimit', true),
            window: Number(getSetting(fc, 'rateLimit', 'window', 60)),
            max: Number(getSetting(fc, 'rateLimit', 'max', 100)),
            storage: String(
              getSetting(fc, 'rateLimit', 'storage', 'secondary-storage'),
            ) as 'memory' | 'database' | 'secondary-storage',
          },
        }
      : {}),
    plugins: buildPluginsConfig(deps, authDb) as any[],
    logger: {
      disabled: false,
      level: 'error',
      log: (level, message) => {
        if (deps.loggerService) {
          deps.loggerService.error(`BetterAuth [${level}]: ${message}`);
        }
      },
    },
    trustedOrigins: corsOrigins,
    advanced: {
      cookiePrefix: cookieConfig.cookiePrefix,
      useSecureCookies,
      defaultCookieAttributes: {
        path: cookieConfig.cookiePath,
      },
    },
    databaseHooks: createTenantDatabaseHooks({
      staticTenantContext: deps.tenantContext,
      existingDatabaseHooks: {
        user: {
          create: {
            before: (user: Record<string, unknown>) => {
              const hasPhone =
                typeof user.phoneNumber === 'string' &&
                user.phoneNumber.trim() !== '';
              if (hasPhone) {
                assignWhatsappNumber(user, false);
              }
              return Promise.resolve({ data: user });
            },
          },
          update: {
            before: (user: Record<string, unknown>) => {
              if (
                'phoneNumber' in user &&
                typeof user.phoneNumber === 'string' &&
                user.phoneNumber.trim() !== ''
              ) {
                assignWhatsappNumber(user, false);
              }
              return Promise.resolve({ data: user });
            },
          },
        },
      },
    }),
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (!deps.auditLogger || !isEnabled(fc, 'auditLogs', false)) return;
        const routePath = String(ctx.path ?? '');
        const trackable =
          routePath.includes('sign-in') ||
          routePath.includes('sign-up') ||
          routePath.includes('sign-out') ||
          routePath.includes('two-factor') ||
          routePath.includes('passkey') ||
          routePath.includes('admin') ||
          routePath.includes('organization') ||
          routePath.includes('api-key');
        if (!trackable) return;

        try {
          const newSession = ctx.context?.newSession as
            | {
                user?: { id?: string; email?: string; role?: string };
              }
            | undefined;
          const existingSession = ctx.context?.session as
            | {
                user?: { id?: string; email?: string; role?: string };
              }
            | undefined;
          const actor = newSession?.user ?? existingSession?.user;
          const effectiveTenant = getEffectiveTenantContext(
            deps.tenantContext,
            ctx.context,
          );
          await deps.auditLogger({
            tenantId: effectiveTenant.tenantId,
            action: `auth.${routePath.replace(/^\/+/, '').replace(/\//g, '.')}`,
            category: routePath.includes('admin')
              ? 'admin'
              : routePath.includes('organization')
                ? 'organization'
                : routePath.includes('api-key')
                  ? 'api-key'
                  : 'auth',
            severity: routePath.includes('ban') ? 'critical' : 'info',
            actorId: actor?.id ?? null,
            actorEmail: actor?.email ?? null,
            actorRole: actor?.role ?? null,
            target: routePath,
            ipAddress:
              ctx.request?.headers?.get('x-forwarded-for') ?? '127.0.0.1',
            userAgent: ctx.request?.headers?.get('user-agent') ?? null,
            metadata: { path: routePath },
          });
        } catch {
          // Audit logging must never interrupt auth responses
        }
      }),
    },
    onAPIError: {
      errorURL,
    },
  };

  return betterAuth({
    ...options,
    plugins: [...(options.plugins ?? [])],
  });
};

export type Auth = ReturnType<typeof createAuthInstance>;

export { buildDefaultFeatureConfigFromEnv };
