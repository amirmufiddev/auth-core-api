import type { AuthCoreRoleRow } from '@/database/schema';

export const PLATFORM_ROLE_REPOSITORY_TOKEN = Symbol(
  'PLATFORM_ROLE_REPOSITORY_TOKEN',
);

export interface IPlatformRoleRepository {
  listAll(): Promise<AuthCoreRoleRow[]>;
  findById(id: string): Promise<AuthCoreRoleRow | null>;
  findBySlug(slug: string): Promise<AuthCoreRoleRow | null>;
  create(input: {
    id: string;
    name: string;
    slug: string;
    description: string;
  }): Promise<AuthCoreRoleRow>;
  update(
    id: string,
    patch: {
      name: string;
      description: string;
      permissions: Record<string, string[]>;
    },
  ): Promise<AuthCoreRoleRow>;
  deleteById(id: string): Promise<void>;
}
