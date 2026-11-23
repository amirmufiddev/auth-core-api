import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import { RequirePlatformPermission } from '@/modules/rbac';
import {
  BillingRecordResponseDto,
  ListBillingRecordsQueryDto,
  RecordBillingDto,
} from '../dto/billing.dto';
import { BillingService } from '../services/billing.service';

interface BillingSessionContext {
  user?: {
    id: string;
    email?: string;
  };
}

@ApiTags('Operator / Billing')
@ApiBearerAuth()
@Controller({ path: 'api/admin/billing', version: VERSION_NEUTRAL })
export class OperatorBillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get()
  @RequirePlatformPermission('organization:read')
  @ApiOperation({ summary: 'Daftar catatan billing ledger terpaginasi' })
  async listRecords(@Query() query: ListBillingRecordsQueryDto) {
    const result = await this.billingService.listRecords({
      page: query.page ?? 0,
      pageSize: query.pageSize ?? 10,
      tenantId: query.tenantId,
      tierId: query.tierId,
      status: query.status,
    });

    return {
      items: result.items.map(BillingRecordResponseDto.fromEntity),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  @Get(':id')
  @RequirePlatformPermission('organization:read')
  @ApiOperation({ summary: 'Detail catatan billing berdasarkan ID' })
  async getRecord(@Param('id') id: string): Promise<BillingRecordResponseDto> {
    const record = await this.billingService.getRecordById(id);
    return BillingRecordResponseDto.fromEntity(record);
  }

  @Post()
  @RequirePlatformPermission('organization:update')
  @ApiOperation({
    summary:
      'Catat transaksi billing ke ledger dan perbarui tenant.billingStatus',
  })
  async recordBilling(
    @Body() body: RecordBillingDto,
    @Session() session: BillingSessionContext | null,
  ): Promise<BillingRecordResponseDto> {
    const created = await this.billingService.recordBilling(
      body,
      session?.user?.id ?? null,
    );
    return BillingRecordResponseDto.fromEntity(created);
  }
}
