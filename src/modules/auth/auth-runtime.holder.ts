import { Injectable } from '@nestjs/common';
import type { Auth } from './auth';
import type { FeatureConfigMap } from './config/feature-catalog';

@Injectable()
export class AuthRuntimeHolder {
  private currentInstance: Auth | null = null;
  private rebuildFn: ((config: FeatureConfigMap) => Auth) | null = null;

  initialize(
    initialInstance: Auth,
    rebuildFn: (config: FeatureConfigMap) => Auth,
  ): void {
    this.currentInstance = initialInstance;
    this.rebuildFn = rebuildFn;
  }

  get current(): Auth {
    if (!this.currentInstance) {
      throw new Error('AuthRuntimeHolder has not been initialized yet.');
    }
    return this.currentInstance;
  }

  reload(config: FeatureConfigMap): Auth {
    if (!this.rebuildFn) {
      throw new Error('AuthRuntimeHolder rebuildFn is not registered.');
    }
    this.currentInstance = this.rebuildFn(config);
    return this.currentInstance;
  }

  createProxy(): Auth {
    const getCurrent = () => this.current;
    const handlerProxy = (req: Request) => getCurrent().handler(req);

    return new Proxy(handlerProxy as unknown as Auth, {
      get(_target, prop) {
        const instance = getCurrent();
        if (prop === 'handler') {
          return (req: Request) => getCurrent().handler(req);
        }
        const value = (instance as unknown as Record<PropertyKey, unknown>)[
          prop
        ];
        if (typeof value === 'function') {
          return (value as (...args: unknown[]) => unknown).bind(instance);
        }
        return value;
      },
      has(_target, prop) {
        return prop in getCurrent();
      },
      ownKeys() {
        return Reflect.ownKeys(getCurrent());
      },
      getOwnPropertyDescriptor(_target, prop) {
        return Object.getOwnPropertyDescriptor(getCurrent(), prop);
      },
    });
  }
}
