import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { configureCors } from './cors.config';
import { envSchema } from '../config/env.validation';

describe('CORS Configuration & Validation', () => {
  describe('envSchema CORS_ORIGINS validation', () => {
    const baseEnv = {
      PORT: '2001',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      BETTER_AUTH_SECRET: 'a-very-long-secret-key-that-is-at-least-32-chars',
      BETTER_AUTH_URL: 'http://localhost:2001',
      BETTER_AUTH_CLIENT_URL: 'http://localhost:3000',
      WAHA_WEBHOOK_SECRET: 'supersecret',
    };

    it('should allow wildcard * when NODE_ENV is development', () => {
      const result = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'development',
        CORS_ORIGINS: '*',
      });
      expect(result.success).toBe(true);
    });

    it('should reject wildcard * when NODE_ENV is production', () => {
      const result = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: '*',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'Wildcard origin (*) is not allowed in production',
        );
      }
    });

    it('should reject CORS_ORIGINS containing wildcard * among other origins in production', () => {
      const result = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com, *',
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid explicit origins in production', () => {
      const result = envSchema.safeParse({
        ...baseEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com, https://app.example.com',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('configureCors', () => {
    let mockApp: Partial<NestFastifyApplication>;
    let mockConfigService: Partial<ConfigService>;
    let enableCorsSpy: jest.Mock;

    beforeEach(() => {
      enableCorsSpy = jest.fn();
      mockApp = {
        enableCors: enableCorsSpy,
      };
    });

    it('should pass dynamic origin callback allowing explicit origins and valid tenant subdomains while rejecting reserved or unknown origins', () => {
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'app.corsOrigins') {
            return 'http://localhost:5173, https://admin.example.com';
          }
          if (key === 'TENANT_BASE_DOMAIN') return 'authcore.local';
          if (key === 'app.nodeEnv') return 'production';
          return undefined;
        }),
      };

      configureCors(
        mockApp as NestFastifyApplication,
        mockConfigService as ConfigService,
      );

      expect(enableCorsSpy).toHaveBeenCalledTimes(1);
      const callArg = enableCorsSpy.mock.calls[0][0];
      expect(callArg.credentials).toBe(true);
      expect(callArg.methods).toEqual([
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'PATCH',
        'OPTIONS',
      ]);
      expect(typeof callArg.origin).toBe('function');

      const checkOrigin = (origin?: string): boolean => {
        let allowed: boolean | undefined;
        callArg.origin(origin, (_err: Error | null, result?: boolean) => {
          allowed = result;
        });
        return Boolean(allowed);
      };

      expect(checkOrigin(undefined)).toBe(true);
      expect(checkOrigin('http://localhost:5173')).toBe(true);
      expect(checkOrigin('https://admin.example.com')).toBe(true);
      expect(checkOrigin('https://pos-amir.authcore.local')).toBe(true);
      expect(checkOrigin('https://auth.authcore.local')).toBe(false);
      expect(checkOrigin('https://console.authcore.local')).toBe(false);
      expect(checkOrigin('https://nested.pos.authcore.local')).toBe(false);
      expect(checkOrigin('https://evil.com')).toBe(false);
    });

    it('should allow valid http://<slug>.localhost:<port> in non-production and reject in production', () => {
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'app.corsOrigins') return ['http://localhost:3000'];
          if (key === 'TENANT_BASE_DOMAIN') return 'authcore.local';
          if (key === 'app.nodeEnv') return 'development';
          return undefined;
        }),
      };

      configureCors(
        mockApp as NestFastifyApplication,
        mockConfigService as ConfigService,
      );

      const devCallback = enableCorsSpy.mock.calls[0][0].origin;
      const checkDev = (origin: string) => {
        let res = false;
        devCallback(origin, (_e: Error | null, ok?: boolean) => {
          res = Boolean(ok);
        });
        return res;
      };
      expect(checkDev('http://pos-amir.localhost:3000')).toBe(true);
      expect(checkDev('http://auth.localhost:3000')).toBe(false);

      enableCorsSpy.mockClear();
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'app.corsOrigins') return ['https://app.authcore.local'];
          if (key === 'TENANT_BASE_DOMAIN') return 'authcore.local';
          if (key === 'app.nodeEnv') return 'production';
          return undefined;
        }),
      };
      configureCors(
        mockApp as NestFastifyApplication,
        mockConfigService as ConfigService,
      );
      const prodCallback = enableCorsSpy.mock.calls[0][0].origin;
      let prodAllowed = true;
      prodCallback(
        'http://pos-amir.localhost:3000',
        (_e: Error | null, ok?: boolean) => {
          prodAllowed = Boolean(ok);
        },
      );
      expect(prodAllowed).toBe(false);
    });

    it('should handle wildcard * as string in non-production', () => {
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'app.corsOrigins') return '*';
          if (key === 'app.nodeEnv') return 'development';
          return undefined;
        }),
      };

      configureCors(
        mockApp as NestFastifyApplication,
        mockConfigService as ConfigService,
      );

      expect(enableCorsSpy).toHaveBeenCalledWith({
        origin: '*',
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      });
    });

    it('should handle undefined corsOrigins without throwing and reject unknown external origins', () => {
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'app.nodeEnv') return 'production';
          if (key === 'TENANT_BASE_DOMAIN') return 'authcore.local';
          return undefined;
        }),
      };

      configureCors(
        mockApp as NestFastifyApplication,
        mockConfigService as ConfigService,
      );

      const cb = enableCorsSpy.mock.calls[0][0].origin;
      let externalAllowed = true;
      cb('https://untrusted.example.com', (_e: Error | null, ok?: boolean) => {
        externalAllowed = Boolean(ok);
      });
      expect(externalAllowed).toBe(false);
    });

    it('should hard-fail in production when corsOrigins is wildcard *', () => {
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'app.nodeEnv') return 'production';
          if (key === 'app.corsOrigins') return '*';
          return undefined;
        }),
      };

      expect(() =>
        configureCors(
          mockApp as NestFastifyApplication,
          mockConfigService as ConfigService,
        ),
      ).toThrow('Wildcard origin (*) is not allowed in production');
    });

    it('should hard-fail in production when corsOrigins array contains wildcard *', () => {
      mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'app.nodeEnv') return 'production';
          if (key === 'app.corsOrigins') {
            return ['https://example.com', '*'];
          }
          return undefined;
        }),
      };

      expect(() =>
        configureCors(
          mockApp as NestFastifyApplication,
          mockConfigService as ConfigService,
        ),
      ).toThrow('Wildcard origin (*) is not allowed in production');
    });
  });
});
