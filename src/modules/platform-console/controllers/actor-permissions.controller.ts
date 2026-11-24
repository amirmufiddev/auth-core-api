import {
  Controller,
  Get,
  UnauthorizedException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import { PlatformActorPermissionsService } from '../services/platform-actor-permissions.service';

interface AuthSessionContext {
  user?: { id: string; email?: string; role?: string | null };
}

@ApiTags('Operator / Actor Permissions')
@ApiBearerAuth()
@Controller({ path: 'api/admin/me', version: VERSION_NEUTRAL })
export class ActorPermissionsController {
  constructor(private readonly service: PlatformActorPermissionsService) {}

  @Get('permissions')
  @ApiOperation({
    summary: 'Matriks izin role platform milik akun yang sedang login',
  })
  async getPermissions(@Session() session: AuthSessionContext | null) {
    if (!session?.user?.id) {
      throw new UnauthorizedException('Sesi login diperlukan.');
    }
    return this.service.getMine(session.user.id);
  }
}