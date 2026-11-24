import { describe, expect, it, mock } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { PlatformActorPermissionsService } from './platform-actor-permissions.service';

function serviceWith(opts: {
  user: { id: string; role: string | null } | null;
  roles: Record<string, Record<string, string[]>>;
}) {
  const userRepo = {
    findPlatformById: mock(() => Promise.resolve(opts.user)),
  };
  const roleRepo = {
    findBySlug: mock((slug: string) =>
      Promise.resolve(
        opts.roles[slug]
          ? { slug, permissions: opts.roles[slug] }
          : null,
      ),
    ),
  };
  return new PlatformActorPermissionsService(
    userRepo as never,
    roleRepo as never,
  );
}

describe('PlatformActorPermissionsService', () => {
  it('returns matrices for each stored role slug without requiring role:read', async () => {
    const service = serviceWith({
      user: { id: 'usr_1', role: 'security_admin,auditor' },
      roles: {
        security_admin: { session: ['read', 'revoke'], organization: ['read'] },
        auditor: { auditLog: ['read', 'export'] },
      },
    });

    await expect(service.getMine('usr_1')).resolves.toEqual({
      roles: [
        {
          slug: 'security_admin',
          permissions: { session: ['read', 'revoke'], organization: ['read'] },
        },
        {
          slug: 'auditor',
          permissions: { auditLog: ['read', 'export'] },
        },
      ],
    });
  });

  it('omits a slug that has no auth_core_role row', async () => {
    const service = serviceWith({
      user: { id: 'usr_1', role: 'ghost,auditor' },
      roles: { auditor: { auditLog: ['read'] } },
    });

    await expect(service.getMine('usr_1')).resolves.toEqual({
      roles: [{ slug: 'auditor', permissions: { auditLog: ['read'] } }],
    });
  });

  it('rejects tenant-scoped and unknown users', async () => {
    const service = serviceWith({ user: null, roles: {} });
    await expect(service.getMine('usr_tenant')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});