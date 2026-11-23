import { describe, expect, it, mock } from 'bun:test';
import * as schema from '@/database/schema';
import { PlatformUserRepository } from './platform-user.repository';

describe('PlatformUserRepository', () => {
  it('should apply WHERE (including isNull tenantId), ORDER BY, LIMIT, OFFSET and parallel COUNT(*) in listPaginated', async () => {
    const limitCalls: number[] = [];
    const offsetCalls: number[] = [];
    const whereCalls: unknown[] = [];

    const dbMock = {
      select: mock((projection?: Record<string, unknown>) => ({
        from: mock((table: unknown) => {
          expect(table).toBe(schema.user);
          return {
            where: mock((clause: unknown) => {
              whereCalls.push(clause);
              if (projection && 'total' in projection) {
                return Promise.resolve([{ total: 27 }]);
              }
              return {
                orderBy: mock(() => ({
                  limit: mock((l: number) => {
                    limitCalls.push(l);
                    return {
                      offset: mock((o: number) => {
                        offsetCalls.push(o);
                        return Promise.resolve([
                          {
                            id: 'usr_1',
                            tenantId: null,
                            name: 'Admin',
                            email: 'admin@authcore.io',
                          },
                        ]);
                      }),
                    };
                  }),
                })),
              };
            }),
          };
        }),
      })),
    } as any;

    const repo = new PlatformUserRepository(dbMock);
    const result = await repo.listPaginated({
      page: 2,
      pageSize: 10,
      search: 'admin',
      role: 'admin',
      status: 'active',
      sortBy: 'email',
      sortDir: 'asc',
    });

    expect(whereCalls).toHaveLength(2);
    expect(whereCalls[0]).toBeDefined();
    expect(whereCalls[1]).toBeDefined();
    expect(limitCalls).toEqual([10]);
    expect(offsetCalls).toEqual([20]);
    expect(result.total).toBe(27);
    expect(result.items).toHaveLength(1);
  });

  it('should use WHERE clause on findPlatformById and findPlatformByEmail', async () => {
    const whereCalls: unknown[] = [];
    const dbMock = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock((clause: unknown) => {
            whereCalls.push(clause);
            return {
              limit: mock((l: number) => {
                expect(l).toBe(1);
                return Promise.resolve([]);
              }),
            };
          }),
        })),
      })),
    } as any;

    const repo = new PlatformUserRepository(dbMock);
    expect(await repo.findPlatformById('usr_1')).toBeNull();
    expect(await repo.findPlatformByEmail('TEST@Example.com')).toBeNull();
    expect(whereCalls).toHaveLength(2);
    expect(whereCalls[0]).toBeDefined();
    expect(whereCalls[1]).toBeDefined();
  });

  it('should clamp negative page and pageSize before issuing SQL LIMIT and OFFSET', async () => {
    const limitCalls: number[] = [];
    const offsetCalls: number[] = [];

    const dbMock = {
      select: mock((projection?: Record<string, unknown>) => ({
        from: mock(() => ({
          where: mock(() => {
            if (projection && 'total' in projection) {
              return Promise.resolve([{ total: 0 }]);
            }
            return {
              orderBy: mock(() => ({
                limit: mock((l: number) => {
                  limitCalls.push(l);
                  return {
                    offset: mock((o: number) => {
                      offsetCalls.push(o);
                      return Promise.resolve([]);
                    }),
                  };
                }),
              })),
            };
          }),
        })),
      })),
    } as any;

    const repo = new PlatformUserRepository(dbMock);
    await repo.listPaginated({ page: -2, pageSize: -5 });

    expect(limitCalls).toEqual([1]);
    expect(offsetCalls).toEqual([0]);
  });
});
