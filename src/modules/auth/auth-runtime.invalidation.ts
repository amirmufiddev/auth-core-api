import type { AppLoggerService } from '@/logger/logger.service';
import { CONFIG_INVALIDATED_CHANNEL } from '@/modules/tenant';
import type {
  AuthRuntimeRedisClient,
  AuthRuntimeRedisSubscriber,
  ConfigInvalidationMessage,
} from './auth-runtime.types';

export interface InvalidationHandlers {
  onTenant: (tenantId: string, configVersion?: number) => Promise<void>;
  onCatalog: (catalogVersion?: number) => void;
  onPlatform: () => Promise<void>;
}

export async function startAuthInvalidationSubscriber(
  redisClient: AuthRuntimeRedisClient | undefined,
  handlers: InvalidationHandlers,
  logger?: AppLoggerService,
): Promise<AuthRuntimeRedisSubscriber | null> {
  if (!redisClient?.duplicate) return null;
  try {
    const sub = redisClient.duplicate();
    sub.on?.('message', (channel, message) => {
      if (channel !== CONFIG_INVALIDATED_CHANNEL) return;
      void handleAuthInvalidationMessage(message, handlers, logger);
    });
    await sub.connect?.().catch(() => {});
    await sub.subscribe?.(CONFIG_INVALIDATED_CHANNEL);
    return sub;
  } catch (error) {
    logger?.warn(
      `Failed to subscribe to ${CONFIG_INVALIDATED_CHANNEL}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'AuthRuntimeRegistry',
    );
    return null;
  }
}

export async function stopAuthInvalidationSubscriber(
  sub: AuthRuntimeRedisSubscriber | null,
): Promise<void> {
  if (!sub) return;
  try {
    await sub.unsubscribe?.(CONFIG_INVALIDATED_CHANNEL);
  } catch {
    // Ignore unsubscribe errors during shutdown
  }
  try {
    if (sub.quit) {
      await sub.quit();
    } else {
      sub.disconnect?.();
    }
  } catch {
    // Ignore disconnect errors during shutdown
  }
}

async function handleAuthInvalidationMessage(
  raw: string,
  handlers: InvalidationHandlers,
  logger?: AppLoggerService,
): Promise<void> {
  try {
    const payload = JSON.parse(raw) as ConfigInvalidationMessage;
    if (payload.scope === 'tenant' && payload.tenantId) {
      await handlers.onTenant(payload.tenantId, payload.configVersion);
      return;
    }
    if (payload.scope === 'catalog') {
      handlers.onCatalog(payload.catalogVersion);
      return;
    }
    if (payload.scope === 'platform') {
      await handlers.onPlatform();
    }
  } catch (error) {
    logger?.warn(
      `Invalid config invalidation payload: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'AuthRuntimeRegistry',
    );
  }
}
