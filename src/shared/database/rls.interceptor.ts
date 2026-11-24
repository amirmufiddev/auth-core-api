import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContextStorage } from '@/modules/tenant';
import { RlsContext } from './rls-context';

export const CROSS_TENANT_ORGANIZATION_ERROR = 'CROSS_TENANT_ORGANIZATION';

export type OrganizationTenantResolver = (
  organizationId: string,
) => Promise<string | null>;

interface SessionWithOrg {
  session?: {
    tenantId?: string | null;
    activeOrganizationId?: string | null;
  };
}

@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(
    private readonly resolveOrganizationTenantId?: OrganizationTenantResolver,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ session?: SessionWithOrg }>();
    const sessionTenantId = req.session?.session?.tenantId ?? null;
    const alsTenantId = TenantContextStorage.get().tenantId;
    const tenantId = sessionTenantId ?? alsTenantId ?? null;
    const organizationId = req.session?.session?.activeOrganizationId ?? null;

    if (!organizationId && !tenantId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      let innerSub: { unsubscribe: () => void } | undefined;
      let cancelled = false;

      const runHandler = () => {
        if (cancelled) return;
        RlsContext.run({ tenantId, organizationId }, () => {
          innerSub = next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
        });
      };

      if (organizationId && this.resolveOrganizationTenantId) {
        this.resolveOrganizationTenantId(organizationId)
          .then((orgTenantId) => {
            if (cancelled) return;
            if (orgTenantId !== null && orgTenantId !== tenantId) {
              subscriber.error(
                new ForbiddenException({
                  code: CROSS_TENANT_ORGANIZATION_ERROR,
                  message:
                    'Organisasi aktif tidak termasuk dalam tenant sesi ini.',
                }),
              );
              return;
            }
            runHandler();
          })
          .catch((err) => {
            if (!cancelled) subscriber.error(err);
          });
      } else {
        runHandler();
      }

      return () => {
        cancelled = true;
        innerSub?.unsubscribe();
      };
    });
  }
}
