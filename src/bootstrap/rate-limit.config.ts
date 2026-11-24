import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { registerFastifyPlugin } from './plugin-register.util';

export async function configureRateLimit(
  app: NestFastifyApplication,
  config: ConfigService,
): Promise<void> {
  const enabled = config.get<boolean>('rateLimit.enabled') ?? true;
  if (!enabled) {
    return;
  }

  const nodeEnv = config.get<string>('app.nodeEnv');
  const defaultMax = nodeEnv === 'development' ? 10000 : 1000;
  const max = config.get<number>('rateLimit.max') ?? defaultMax;
  const timeWindow = config.get<string>('rateLimit.timeWindow') ?? '1 minute';

  await registerFastifyPlugin(app, fastifyRateLimit, {
    max,
    timeWindow,
    allowList: (request) => {
      const path = request.url.split('?')[0];
      return path === '/health' || path.startsWith('/v1/health');
    },
  });
}
