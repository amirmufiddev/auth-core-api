import type { OpenAPIObject } from '@nestjs/swagger';
import { authConfig } from '@/config/auth.config';
import { mergeOpenAPISpecs } from './openapi-merger.util';

const minimalBetterAuth: OpenAPIObject = {
  openapi: '3.0.0',
  info: { title: 'BA', version: '1' },
  paths: {
    '/session': {
      get: { tags: ['session'], responses: { '200': { description: 'ok' } } },
    },
  },
};

const minimalCustom: OpenAPIObject = {
  openapi: '3.0.0',
  info: { title: 'C', version: '1' },
  paths: {
    '/users': {
      get: { tags: ['users'], responses: { '200': { description: 'ok' } } },
    },
  },
};

describe('mergeOpenAPISpecs', () => {
  it('should prefix Better Auth paths with configured path and tags with Auth', () => {
    const authPrefix = authConfig().path;
    const expectedSessionPath = `${authPrefix}/session`;
    const merged = mergeOpenAPISpecs(minimalBetterAuth, minimalCustom, {
      betterAuthTagPrefix: 'Auth',
    });
    expect(Object.keys(merged.paths)).toEqual(
      expect.arrayContaining([expectedSessionPath, '/users']),
    );
    expect(merged.paths[expectedSessionPath].get!.tags).toEqual([
      'Auth:session',
    ]);
  });

  it('should not double-prefix when called twice', () => {
    const once = mergeOpenAPISpecs(minimalBetterAuth, minimalCustom, {
      betterAuthTagPrefix: 'Auth',
    });
    const twice = mergeOpenAPISpecs(minimalBetterAuth, once, {
      betterAuthTagPrefix: 'Auth',
    });
    expect(Object.keys(twice.paths)).toEqual(Object.keys(once.paths));
  });
});
