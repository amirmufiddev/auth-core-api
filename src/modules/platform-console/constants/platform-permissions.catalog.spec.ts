import { describe, expect, it } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { assertPlatformPermissionMatrix } from './platform-permissions.catalog';

describe('assertPlatformPermissionMatrix', () => {
  it('accepts actions that exist in the platform catalog', () => {
    expect(() =>
      assertPlatformPermissionMatrix({
        user: ['read', 'ban'],
        auditLog: ['export'],
      }),
    ).not.toThrow();
  });

  it('rejects an unknown resource or action', () => {
    expect(() =>
      assertPlatformPermissionMatrix({ invoice: ['read'] }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertPlatformPermissionMatrix({ user: ['archive'] }),
    ).toThrow(BadRequestException);
  });
});
