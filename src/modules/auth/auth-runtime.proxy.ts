import type { Auth } from './auth';

export function createContextAwareAuthProxy(
  resolveForCurrentContext: () => Promise<Auth>,
  getPlatform: () => Auth,
): Auth {
  const getPlatformApi = () =>
    (getPlatform() as unknown as { api?: Record<PropertyKey, unknown> }).api;

  const apiProxy = new Proxy({} as Record<PropertyKey, unknown>, {
    get: (_target, methodProp) => {
      const platformApi = getPlatformApi();
      if (typeof methodProp === 'symbol' || methodProp === 'then') {
        return platformApi?.[methodProp];
      }

      if (
        platformApi &&
        methodProp in platformApi &&
        typeof platformApi[methodProp] !== 'function'
      ) {
        return platformApi[methodProp];
      }

      return async (...args: unknown[]) => {
        const instance = await resolveForCurrentContext();
        const apiObj = (
          instance as unknown as { api?: Record<PropertyKey, unknown> }
        ).api;
        const fn = apiObj?.[methodProp];
        if (typeof fn === 'function') {
          return (fn as (...fnArgs: unknown[]) => unknown).apply(apiObj, args);
        }

        const currentPlatformApi = getPlatformApi();
        const fallback = currentPlatformApi?.[methodProp];
        if (typeof fallback === 'function') {
          return (fallback as (...fnArgs: unknown[]) => unknown).apply(
            currentPlatformApi,
            args,
          );
        }
        return fallback;
      };
    },
    has: (_target, methodProp) => {
      const platformApi = getPlatformApi();
      return platformApi ? methodProp in platformApi : false;
    },
    ownKeys: () => {
      const platformApi = getPlatformApi();
      return platformApi ? Reflect.ownKeys(platformApi) : [];
    },
    getOwnPropertyDescriptor: (_target, methodProp) => {
      const platformApi = getPlatformApi();
      return platformApi
        ? Object.getOwnPropertyDescriptor(platformApi, methodProp)
        : undefined;
    },
  });

  const handlerProxy = async (req: Request) => {
    const instance = await resolveForCurrentContext();
    return instance.handler(req);
  };

  return new Proxy(handlerProxy as unknown as Auth, {
    get: (_target, prop) => {
      if (prop === 'handler') {
        return handlerProxy;
      }
      if (prop === 'api') {
        return apiProxy;
      }
      const platform = getPlatform();
      const value = (platform as unknown as Record<PropertyKey, unknown>)[prop];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(platform);
      }
      return value;
    },
    has: (_target, prop) => prop in getPlatform(),
    ownKeys: () => Reflect.ownKeys(getPlatform()),
    getOwnPropertyDescriptor: (_target, prop) =>
      Object.getOwnPropertyDescriptor(getPlatform(), prop),
  });
}
