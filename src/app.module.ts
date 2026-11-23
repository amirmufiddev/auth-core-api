import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import {
  I18nModule,
  AcceptLanguageResolver,
  QueryResolver,
  CookieResolver,
  HeaderResolver,
} from 'nestjs-i18n';
import {
  appConfig,
  emailConfig,
  queueConfig,
  uploadConfig,
  validate,
} from './config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth';
import { PlatformConsoleModule } from './modules/platform-console';
import { HealthModule } from './modules/health';
import { LoggerModule } from './logger/logger.module';
import { RbacModule } from './modules/rbac';
import { UploadModule } from './modules/upload';
import { MemberModule } from './modules/member';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { i18nOptionsFactory } from './i18n';
import { authConfig } from './config/auth.config';
import { SharedEventsModule } from './shared/events/shared-events.module';
import { MetricsModule } from './infrastructure/metrics/metrics.module';
import { GlobalCacheModule } from './common/cache/cache.module';
import { CryptoModule } from './common/crypto';

/**
 * Auth Core `AppModule` — auth, member, rbac, upload, health, email.
 */
@Module({
  imports: [
    GlobalCacheModule,
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate,
      load: [appConfig, authConfig, emailConfig, queueConfig, uploadConfig],
    }),

    I18nModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        i18nOptionsFactory(
          configService.get<string>('app.fallbackLanguage', { infer: true }),
        ),
      resolvers: [
        new QueryResolver(['lang', 'locale']),
        new CookieResolver(['lang', 'locale']),
        new HeaderResolver(['x-lang', 'x-locale']),
        AcceptLanguageResolver,
      ],
    }),
    LoggerModule,
    DatabaseModule,
    CryptoModule,
    MetricsModule,
    SharedEventsModule,
    AuthModule,
    PlatformConsoleModule,
    HealthModule,
    RbacModule,
    UploadModule,
    MemberModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*splat}');
  }
}
