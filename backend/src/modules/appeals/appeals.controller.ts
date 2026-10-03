import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { AppealsService } from './appeals.service';

@Controller('api')
@UseGuards(AuthGuard, RoleGuard)
export class AppealsController {
  constructor(private appeals: AppealsService) {}

  // 工人发起申诉
  @Roles('WORKER')
  @Post('appeals')
  create(@Req() req: any, @Body() dto: { assignmentId: number; reason: string; claimedAmount?: number }) {
    return this.appeals.create(req.user.sub, Number(dto.assignmentId), dto.reason, Number(dto.claimedAmount || 0));
  }

  @Roles('WORKER')
  @Get('my/appeals')
  mine(@Req() req: any) {
    return this.appeals.listForWorker(req.user.sub);
  }

  @Roles('ENTERPRISE')
  @Get('enterprise/appeals')
  entMine(@Req() req: any) {
    return this.appeals.listForEnterprise(req.user.enterpriseId);
  }

  // ---------- 客服 ----------
  @Roles('SUPPORT')
  @Get('support/appeals')
  listAll(@Query('status') status?: string) {
    return this.appeals.listAll(status);
  }

  @Roles('SUPPORT')
  @Get('support/appeals/:id/evidence')
  evidence(@Param('id') id: string) {
    return this.appeals.evidence(Number(id));
  }

  @Roles('SUPPORT')
  @Post('support/appeals/:id/decide')
  decide(
    @Param('id') id: string,
    @Body() dto: { decision: 'REISSUED' | 'UPHELD' | 'ARBITRATION'; note: string; reissueAmount?: number },
    @Req() req: any,
  ) {
    return this.appeals.decide(req.user.sub, Number(id), dto.decision, dto.note, dto.reissueAmount);
  }

  @Roles('SUPPORT')
  @Post('support/appeals/:id/arbitrate')
  arbitrate(
    @Param('id') id: string,
    @Body() dto: { award: string; reissueAmount?: number },
    @Req() req: any,
  ) {
    return this.appeals.arbitrate(req.user.sub, Number(id), dto.award, Number(dto.reissueAmount || 0));
  }
}
