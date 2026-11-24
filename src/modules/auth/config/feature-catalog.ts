export type BetterAuthFeatureCategory =
  | 'core'
  | 'authentication'
  | 'social'
  | 'authorization'
  | 'enterprise'
  | 'utility'
  | 'payments';

export type BetterAuthFeatureId =
  | 'emailAndPassword'
  | 'emailVerification'
  | 'accountLinking'
  | 'sessionManagement'
  | 'rateLimit'
  | 'twoFactor'
  | 'passkey'
  | 'magicLink'
  | 'emailOTP'
  | 'username'
  | 'phoneNumber'
  | 'anonymous'
  | 'oneTap'
  | 'siwe'
  | 'genericOAuth'
  | 'socialGoogle'
  | 'socialGithub'
  | 'socialMicrosoft'
  | 'socialApple'
  | 'socialDiscord'
  | 'socialGitlab'
  | 'socialSlack'
  | 'socialLinkedin'
  | 'socialTwitter'
  | 'socialFigma'
  | 'socialNotion'
  | 'socialLinear'
  | 'socialVercel'
  | 'admin'
  | 'organization'
  | 'apiKey'
  | 'agentAuth'
  | 'oauthProvider'
  | 'mcp'
  | 'deviceAuthorization'
  | 'sso'
  | 'scim'
  | 'bearer'
  | 'jwt'
  | 'multiSession'
  | 'captcha'
  | 'haveIBeenPwned'
  | 'lastLoginMethod'
  | 'oneTimeToken'
  | 'oauthProxy'
  | 'openAPI'
  | 'i18n'
  | 'auditLogs'
  | 'stripe'
  | 'polar'
  | 'autumn'
  | 'dodoPayments'
  | 'creem'
  | 'chargebee';

export interface FeatureAvailableSetting {
  key: string;
  label: string;
  type: string;
  options?: Array<{ label: string; value: string | number | boolean } | string>;
  defaultValue?: string | number | boolean;
  required?: boolean;
}

export interface FeatureRuntimeConfig {
  enabled: boolean;
  settings: Record<string, string | number | boolean>;
  secretsConfigured?: Record<string, boolean>;
}

export type FeatureConfigMap = Record<
  BetterAuthFeatureId,
  FeatureRuntimeConfig
>;

export interface FeatureCatalogEntry {
  id: BetterAuthFeatureId;
  name: string;
  category: BetterAuthFeatureCategory;
  packageName: string;
  available: boolean;
  unavailableReason?: string;
  dependencies?: BetterAuthFeatureId[];
  defaultEnabled: boolean;
  defaultSettings: Record<string, string | number | boolean>;
  availableSetting?: FeatureAvailableSetting[];
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export function featureIdToEnvKey(id: BetterAuthFeatureId): string {
  return `AUTH_FEATURE_${id.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
}

export const BETTER_AUTH_FEATURE_CATALOG: FeatureCatalogEntry[] = [
  {
    id: 'emailAndPassword',
    name: 'Email & Password',
    category: 'core',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      requireEmailVerification: false,
    },
  },
  {
    id: 'emailVerification',
    name: 'Email Verification',
    category: 'core',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
    },
  },
  {
    id: 'accountLinking',
    name: 'Account Linking',
    category: 'core',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      enabled: true,
      allowDifferentEmails: false,
      trustedProviders: 'google,github',
    },
  },
  {
    id: 'sessionManagement',
    name: 'Session Management',
    category: 'core',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      expiresIn: 604800,
      updateAge: 86400,
      cookieCacheEnabled: true,
      cookieCacheMaxAge: 300,
    },
  },
  {
    id: 'rateLimit',
    name: 'Rate Limiting',
    category: 'core',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      window: 60,
      max: 100,
      storage: 'secondary-storage',
    },
  },
  {
    id: 'twoFactor',
    name: 'Two-Factor Auth (2FA)',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      issuer: 'Auth Core',
      totpDigits: '6',
      backupCodeAmount: 10,
    },
  },
  {
    id: 'passkey',
    name: 'Passkey (WebAuthn)',
    category: 'authentication',
    packageName: '@better-auth/passkey',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      rpID: 'localhost',
      rpName: 'Auth Core Identity',
      authenticatorAttachment: 'any',
    },
  },
  {
    id: 'magicLink',
    name: 'Magic Link',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      expiresIn: 300,
      disableSignUp: false,
    },
  },
  {
    id: 'emailOTP',
    name: 'Email OTP',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
    },
  },
  {
    id: 'username',
    name: 'Username Auth',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      minUsernameLength: 3,
      maxUsernameLength: 30,
    },
  },
  {
    id: 'phoneNumber',
    name: 'Phone Number & SMS OTP',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      otpLength: 6,
      expiresIn: 300,
      requireVerification: true,
    },
  },
  {
    id: 'anonymous',
    name: 'Anonymous Guest Auth',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      emailDomainName: 'guest.authcore.local',
      disableDeleteAnonymousUser: false,
    },
  },
  {
    id: 'oneTap',
    name: 'Google One Tap',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    dependencies: ['socialGoogle'],
    defaultEnabled: false,
    defaultSettings: {
      clientId: '',
      disableSignup: false,
    },
  },
  {
    id: 'siwe',
    name: 'Sign In With Ethereum (SIWE)',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      domain: 'authcore.local',
      anonymous: true,
    },
  },
  {
    id: 'genericOAuth',
    name: 'Generic OAuth / OIDC',
    category: 'authentication',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      providerId: 'keycloak',
      discoveryUrl: '',
      clientId: '',
    },
  },
  {
    id: 'socialGoogle',
    name: 'Google OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: true,
    defaultSettings: { clientId: '', prompt: 'select_account' },
  },
  {
    id: 'socialGithub',
    name: 'GitHub OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: true,
    defaultSettings: { clientId: '', scope: 'read:user user:email' },
  },
  {
    id: 'socialMicrosoft',
    name: 'Microsoft Entra ID',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '', tenantId: 'common' },
  },
  {
    id: 'socialApple',
    name: 'Apple Sign In',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialDiscord',
    name: 'Discord OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialGitlab',
    name: 'GitLab OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialSlack',
    name: 'Slack OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialLinkedin',
    name: 'LinkedIn OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialTwitter',
    name: 'X (Twitter) OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialFigma',
    name: 'Figma OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialNotion',
    name: 'Notion OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialLinear',
    name: 'Linear OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'socialVercel',
    name: 'Vercel OAuth',
    category: 'social',
    packageName: 'better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { clientId: '' },
  },
  {
    id: 'admin',
    name: 'Admin & RBAC',
    category: 'authorization',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      defaultRole: 'user',
      adminRoles: 'super_admin,admin',
      impersonationSessionDuration: 3600,
    },
  },
  {
    id: 'organization',
    name: 'Organizations & Teams',
    category: 'authorization',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      teamsEnabled: true,
      invitationExpiresIn: 172800,
    },
  },
  {
    id: 'apiKey',
    name: 'API Keys',
    category: 'authorization',
    packageName: '@better-auth/api-key',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      defaultPrefix: 'ak_live_',
      defaultKeyLength: 48,
      enableMetadata: true,
      rateLimitEnabled: true,
    },
  },
  {
    id: 'agentAuth',
    name: 'Agent Auth',
    category: 'authorization',
    packageName: '@better-auth/agent-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      requireApproval: true,
      tokenTTL: 1800,
    },
  },
  {
    id: 'oauthProvider',
    name: 'OAuth 2.1 & OIDC Provider',
    category: 'enterprise',
    packageName: '@better-auth/oauth-provider',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 2592000,
      allowDynamicClientRegistration: false,
    },
  },
  {
    id: 'mcp',
    name: 'MCP OAuth Provider',
    category: 'enterprise',
    packageName: '@better-auth/mcp',
    available: true,
    dependencies: ['oauthProvider'],
    defaultEnabled: true,
    defaultSettings: {
      loginPage: '/login',
      resource: 'http://localhost:2001/mcp',
    },
  },
  {
    id: 'deviceAuthorization',
    name: 'Device Authorization Grant',
    category: 'enterprise',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      expiresIn: 600,
      interval: 5,
    },
  },
  {
    id: 'sso',
    name: 'Enterprise SSO (SAML & OIDC)',
    category: 'enterprise',
    packageName: '@better-auth/sso',
    available: true,
    dependencies: ['organization'],
    defaultEnabled: true,
    defaultSettings: {
      domainVerification: true,
      provisionUser: true,
    },
  },
  {
    id: 'scim',
    name: 'SCIM 2.0 Provisioning',
    category: 'enterprise',
    packageName: '@better-auth/scim',
    available: true,
    dependencies: ['organization', 'sso'],
    defaultEnabled: false,
    defaultSettings: {
      storeSCIMToken: 'hashed',
    },
  },
  {
    id: 'bearer',
    name: 'Bearer Token Auth',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      requireSignature: true,
    },
  },
  {
    id: 'jwt',
    name: 'JWT & JWKS',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      expirationTime: '15m',
      algorithm: 'EdDSA',
    },
  },
  {
    id: 'multiSession',
    name: 'Multi-Session Switcher',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      maximumSessions: 5,
    },
  },
  {
    id: 'captcha',
    name: 'Captcha Protection',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      provider: 'cloudflare-turnstile',
      siteKey: '',
    },
  },
  {
    id: 'haveIBeenPwned',
    name: 'Have I Been Pwned',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      customPasswordCompromisedMessage:
        'Kata sandi terdeteksi dalam kebocoran data publik.',
    },
  },
  {
    id: 'lastLoginMethod',
    name: 'Last Login Method',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      cookieName: 'authcore.last_used_login_method',
      maxAge: 2592000,
    },
  },
  {
    id: 'oneTimeToken',
    name: 'One-Time Token (OTT)',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      expiresIn: 3,
    },
  },
  {
    id: 'oauthProxy',
    name: 'OAuth Proxy',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: false,
    defaultSettings: {
      currentURL: '',
      productionURL: 'https://auth.authcore.io',
    },
  },
  {
    id: 'openAPI',
    name: 'OpenAPI Docs',
    category: 'utility',
    packageName: 'better-auth/plugins',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      path: '/reference',
      disableDefaultReference: false,
    },
  },
  {
    id: 'i18n',
    name: 'i18n Error Translation',
    category: 'utility',
    packageName: '@better-auth/i18n',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      defaultLocale: 'id',
    },
  },
  {
    id: 'auditLogs',
    name: 'Audit Logs',
    category: 'utility',
    packageName: 'auth-core/audit-trail',
    available: true,
    defaultEnabled: true,
    defaultSettings: {
      retentionDays: 90,
      captureIP: true,
    },
  },
  {
    id: 'stripe',
    name: 'Stripe Billing',
    category: 'payments',
    packageName: '@better-auth/stripe',
    available: true,
    defaultEnabled: false,
    defaultSettings: { createCustomerOnSignUp: true },
  },
  {
    id: 'polar',
    name: 'Polar Payments',
    category: 'payments',
    packageName: '@polar-sh/better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { environment: 'sandbox' },
  },
  {
    id: 'autumn',
    name: 'Autumn Billing',
    category: 'payments',
    packageName: 'autumn-js',
    available: false,
    unavailableReason:
      'autumn-js >= 1.6 menghapus subpath plugin autumn-js/better-auth; gunakan SDK server Autumn langsung.',
    defaultEnabled: false,
    defaultSettings: { url: '' },
  },
  {
    id: 'dodoPayments',
    name: 'Dodo Payments',
    category: 'payments',
    packageName: '@dodopayments/better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { environment: 'test_mode' },
  },
  {
    id: 'creem',
    name: 'Creem Checkout',
    category: 'payments',
    packageName: '@creem_io/better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { testMode: true },
  },
  {
    id: 'chargebee',
    name: 'Chargebee Billing',
    category: 'payments',
    packageName: '@chargebee/better-auth',
    available: true,
    defaultEnabled: false,
    defaultSettings: { site: '' },
  },
];

const SECRET_SETTING_KEY_PATTERN = /secret|token|password|apikey|private/i;

const FEATURE_SECRET_SETTINGS: Partial<
  Record<BetterAuthFeatureId, FeatureAvailableSetting[]>
> = {
  genericOAuth: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialGoogle: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialGithub: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialMicrosoft: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialApple: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialDiscord: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialGitlab: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialSlack: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialLinkedin: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialTwitter: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialFigma: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialNotion: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialLinear: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  socialVercel: [
    { key: 'clientId', label: 'Client ID', type: 'string', required: true },
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: true,
    },
  ],
  captcha: [
    { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
  ],
  haveIBeenPwned: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: false },
  ],
  sso: [
    {
      key: 'clientSecret',
      label: 'Client Secret',
      type: 'secret',
      required: false,
    },
  ],
  scim: [
    { key: 'scimToken', label: 'SCIM Token', type: 'secret', required: false },
  ],
  stripe: [
    { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  polar: [
    {
      key: 'accessToken',
      label: 'Access Token',
      type: 'secret',
      required: true,
    },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  autumn: [
    { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
  ],
  dodoPayments: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  creem: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
  chargebee: [
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true },
    {
      key: 'webhookSecret',
      label: 'Webhook Secret',
      type: 'secret',
      required: true,
    },
  ],
};

function settingKeyToLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function buildCatalogAvailableSettings(
  item: Pick<FeatureCatalogEntry, 'id' | 'defaultSettings'>,
): FeatureAvailableSetting[] {
  const settings: FeatureAvailableSetting[] = [];
  const seenKeys = new Set<string>();
  const explicitSecretKeys = new Set(
    (FEATURE_SECRET_SETTINGS[item.id] ?? [])
      .filter((field) => field.type === 'secret')
      .map((field) => field.key),
  );

  for (const [key, value] of Object.entries(item.defaultSettings)) {
    seenKeys.add(key);
    const isSecret = explicitSecretKeys.has(key);
    const type = isSecret
      ? 'secret'
      : typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'number'
          ? 'number'
          : 'string';

    settings.push({
      key,
      label: settingKeyToLabel(key),
      type,
      ...(isSecret ? {} : { defaultValue: value }),
    });
  }

  for (const field of FEATURE_SECRET_SETTINGS[item.id] ?? []) {
    if (!seenKeys.has(field.key)) {
      seenKeys.add(field.key);
      settings.push(field);
    }
  }

  return settings;
}

for (const entry of BETTER_AUTH_FEATURE_CATALOG) {
  entry.availableSetting = buildCatalogAvailableSettings(entry);
}

export const BETTER_AUTH_FEATURE_CATALOG_MAP: Record<
  BetterAuthFeatureId,
  FeatureCatalogEntry
> = Object.fromEntries(
  BETTER_AUTH_FEATURE_CATALOG.map((item) => [item.id, item]),
) as Record<BetterAuthFeatureId, FeatureCatalogEntry>;

export function getSecretFieldKeys(id: BetterAuthFeatureId): string[] {
  const entry = BETTER_AUTH_FEATURE_CATALOG_MAP[id];
  return (entry?.availableSetting ?? [])
    .filter((s) => s.type === 'secret')
    .map((s) => s.key);
}

export function buildDefaultFeatureConfigFromEnv(): FeatureConfigMap {
  const map = {} as FeatureConfigMap;
  for (const item of BETTER_AUTH_FEATURE_CATALOG) {
    const enabled = item.available
      ? envBool(featureIdToEnvKey(item.id), item.defaultEnabled)
      : false;
    map[item.id] = {
      enabled,
      settings: { ...item.defaultSettings },
    };
  }
  return map;
}

export function mergeFeatureConfig(
  base: FeatureConfigMap,
  incoming?: Partial<
    Record<string, { enabled?: boolean; settings?: Record<string, unknown> }>
  >,
): FeatureConfigMap {
  const next = {} as FeatureConfigMap;
  for (const item of BETTER_AUTH_FEATURE_CATALOG) {
    const prev = base[item.id];
    const patch = incoming?.[item.id];
    const nextSettings: Record<string, string | number | boolean> = {
      ...prev.settings,
    };
    if (patch?.settings && typeof patch.settings === 'object') {
      for (const [k, v] of Object.entries(patch.settings)) {
        if (
          typeof v === 'string' ||
          typeof v === 'number' ||
          typeof v === 'boolean'
        ) {
          nextSettings[k] = v;
        }
      }
    }
    next[item.id] = {
      enabled:
        typeof patch?.enabled === 'boolean'
          ? item.available
            ? patch.enabled
            : false
          : prev.enabled,
      settings: nextSettings,
    };
  }
  return next;
}

export function normalizeFeatureDependencies(
  config: FeatureConfigMap,
): FeatureConfigMap {
  const next = mergeFeatureConfig(config);
  for (const item of BETTER_AUTH_FEATURE_CATALOG) {
    if (next[item.id].enabled && item.dependencies?.length) {
      for (const dep of item.dependencies) {
        if (BETTER_AUTH_FEATURE_CATALOG_MAP[dep]?.available) {
          next[dep] = {
            ...next[dep],
            enabled: true,
          };
        }
      }
    }
  }
  return next;
}

export function sanitizeFeatureConfigForPublic(
  config: FeatureConfigMap,
  secretsByFeature?: Partial<
    Record<BetterAuthFeatureId, Record<string, unknown>>
  >,
): FeatureConfigMap {
  const sanitized = mergeFeatureConfig(config);
  for (const item of BETTER_AUTH_FEATURE_CATALOG) {
    const secretKeys = new Set(getSecretFieldKeys(item.id));
    const knownNonSecretKeys = new Set(
      Object.keys(item.defaultSettings).filter((key) => !secretKeys.has(key)),
    );
    const settings = { ...sanitized[item.id].settings };
    for (const key of Object.keys(settings)) {
      if (
        secretKeys.has(key) ||
        (!knownNonSecretKeys.has(key) && SECRET_SETTING_KEY_PATTERN.test(key))
      ) {
        delete settings[key];
      }
    }

    const featureSecrets = secretsByFeature?.[item.id];
    const secretsConfigured: Record<string, boolean> = {};
    for (const key of secretKeys) {
      secretsConfigured[key] = Boolean(featureSecrets?.[key]);
    }
    for (const key of Object.keys(featureSecrets ?? {})) {
      if (!(key in secretsConfigured)) {
        secretsConfigured[key] = Boolean(featureSecrets?.[key]);
      }
    }

    sanitized[item.id] = {
      enabled: sanitized[item.id].enabled,
      settings,
      ...(secretsByFeature !== undefined || secretKeys.size > 0
        ? { secretsConfigured }
        : {}),
    };
  }
  return sanitized;
}
