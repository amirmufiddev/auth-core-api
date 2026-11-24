import { RlsInterceptor } from './rls.interceptor';
import { RlsContext } from './rls-context';
import {
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';

describe('RlsInterceptor', () => {
  let interceptor: RlsInterceptor;

  beforeEach(() => {
    interceptor = new RlsInterceptor();
  });

  it('should run handler inside RlsContext when session has activeOrganizationId', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          session: { session: { activeOrganizationId: 'org-abc' } },
        }),
      }),
    } as unknown as ExecutionContext;

    let capturedOrganizationId: string | null = null;
    const handler: CallHandler = {
      handle: () =>
        of(
          (() => {
            capturedOrganizationId = RlsContext.getCurrentOrganizationId();
            return 'ok';
          })(),
        ),
    };

    const result = await lastValueFrom(
      interceptor.intercept(mockContext, handler),
    );
    expect(result).toBe('ok');
    expect(capturedOrganizationId).toBe('org-abc');
  });

  it('should pass through with null organizationId when no session', async () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    let capturedOrganizationId: string | null = null;
    const handler: CallHandler = {
      handle: () =>
        of(
          (() => {
            capturedOrganizationId = RlsContext.getCurrentOrganizationId();
            return 'ok';
          })(),
        ),
    };

    await lastValueFrom(interceptor.intercept(mockContext, handler));
    expect(capturedOrganizationId).toBeNull();
  });

  it('should populate both tenantId and organizationId in RlsContext when organization belongs to session tenant', async () => {
    const tenantScopedInterceptor = new RlsInterceptor(async () => 'tenant-1');
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          session: {
            session: {
              tenantId: 'tenant-1',
              activeOrganizationId: 'org-1',
            },
          },
        }),
      }),
    } as unknown as ExecutionContext;

    let capturedTenantId: string | null = null;
    let capturedOrganizationId: string | null = null;
    const handler: CallHandler = {
      handle: () =>
        of(
          (() => {
            capturedTenantId = RlsContext.getCurrentTenantId();
            capturedOrganizationId = RlsContext.getCurrentOrganizationId();
            return 'ok';
          })(),
        ),
    };

    const result = await lastValueFrom(
      tenantScopedInterceptor.intercept(mockContext, handler),
    );
    expect(result).toBe('ok');
    expect(capturedTenantId).toBe('tenant-1');
    expect(capturedOrganizationId).toBe('org-1');
  });

  it('should reject with 403 CROSS_TENANT_ORGANIZATION when activeOrganizationId belongs to another tenant', async () => {
    const tenantScopedInterceptor = new RlsInterceptor(async () => 'tenant-b');
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          session: {
            session: {
              tenantId: 'tenant-a',
              activeOrganizationId: 'org-from-tenant-b',
            },
          },
        }),
      }),
    } as unknown as ExecutionContext;

    const handler: CallHandler = {
      handle: () => of('should-not-run'),
    };

    let caughtError: unknown;
    try {
      await lastValueFrom(
        tenantScopedInterceptor.intercept(mockContext, handler),
      );
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ForbiddenException);
    expect((caughtError as ForbiddenException).getResponse()).toMatchObject({
      code: 'CROSS_TENANT_ORGANIZATION',
    });
  });
});
