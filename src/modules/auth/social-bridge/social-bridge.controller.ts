import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TenantContextStorage } from '@/modules/tenant';
import { resolveTenantCookieConfig } from '../multi-tenant/tenant-auth-hooks';
import { SocialBridgeService } from './social-bridge.service';

@Controller({ path: 'api/social-bridge', version: VERSION_NEUTRAL })
export class SocialBridgeController {
  constructor(private readonly socialBridgeService: SocialBridgeService) {}

  @Get('start/:provider')
  @AllowAnonymous()
  async start(
    @Param('provider') provider: string,
    @Query('returnTo') returnTo: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ctx = TenantContextStorage.get();
    if (!ctx.tenantId || !ctx.slug || ctx.source === 'platform') {
      throw new BadRequestException({
        statusCode: 400,
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Social login bridge harus dimulai dari konteks tenant.',
      });
    }

    const authorizeUrl =
      await this.socialBridgeService.buildAuthorizeRedirectUrl({
        tenantId: ctx.tenantId,
        tenantSlug: ctx.slug,
        mode: ctx.source === 'path' ? 'path' : 'subdomain',
        provider,
        returnTo,
      });

    void reply.redirect(authorizeUrl, 302);
  }

  @Get('callback/:provider')
  @AllowAnonymous()
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!code || !state) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MISSING_OAUTH_PARAMS',
        message: 'Parameter code dan state wajib disertakan.',
      });
    }

    const { redirectUrl } =
      await this.socialBridgeService.handleCentralCallback({
        provider,
        code,
        state,
      });

    // Central host MUST NOT issue any session Set-Cookie header.
    void reply.redirect(redirectUrl, 302);
  }

  @Get('exchange')
  @AllowAnonymous()
  async exchange(
    @Query('code') code: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ctx = TenantContextStorage.get();
    if (!ctx.tenantId || !ctx.slug || ctx.source === 'platform') {
      throw new BadRequestException({
        statusCode: 400,
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'Exchange harus dijalankan pada host tenant.',
      });
    }

    const { sessionToken, redirectTo } =
      await this.socialBridgeService.exchangeOnTenantHost(code, ctx.tenantId);

    const cookieConfig = resolveTenantCookieConfig(ctx);
    const cookieName = `${cookieConfig.cookiePrefix}.session_token`;
    const isSecure =
      req.protocol === 'https' ||
      req.headers['x-forwarded-proto'] === 'https';

    const cookieParts = [
      `${cookieName}=${encodeURIComponent(sessionToken)}`,
      `Path=${cookieConfig.cookiePath}`,
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${7 * 24 * 60 * 60}`,
    ];
    if (isSecure) {
      cookieParts.push('Secure');
    }

    // Host-only cookie: intentionally omit Domain attribute.
    void reply.header('Set-Cookie', cookieParts.join('; '));
    void reply.redirect(redirectTo, 302);
  }
}
