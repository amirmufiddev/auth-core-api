import { describe, expect, it } from 'bun:test';
import { AuthRuntimeHolder } from './auth-runtime.holder';
import { buildDefaultFeatureConfigFromEnv } from './config/feature-catalog';

describe('AuthRuntimeHolder', () => {
  it('should forward api and handler calls to current instance and hot-swap on reload', async () => {
    const holder = new AuthRuntimeHolder();
    const authV1 = {
      api: { version: 1 },
      handler: () => Promise.resolve(new Response('v1')),
    } as any;
    const authV2 = {
      api: { version: 2 },
      handler: () => Promise.resolve(new Response('v2')),
    } as any;

    holder.initialize(authV1, () => authV2);
    const proxy = holder.createProxy() as any;

    expect(proxy.api.version).toBe(1);
    const res1 = await proxy.handler(new Request('http://localhost/test'));
    expect(await res1.text()).toBe('v1');

    holder.reload(buildDefaultFeatureConfigFromEnv());

    expect(proxy.api.version).toBe(2);
    const res2 = await proxy.handler(new Request('http://localhost/test'));
    expect(await res2.text()).toBe('v2');
  });
});
