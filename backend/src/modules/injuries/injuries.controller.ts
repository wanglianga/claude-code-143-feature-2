import {
  Body, Controller, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { InjuryCasesService } from './injuries.service';

@Controller('api')
@UseGuards(AuthGuard, RoleGuard)
export class InjuriesController {
  constructor(private svc: InjuryCasesService) {}

  // ---------- 工人：现场记录工伤事件（事故时间/岗位/照片/就医票据） ----------
  @Roles('WORKER')
  @Post('injuries')
  report(@Req() req: any, @Body() dto: any) {
    return this.svc.reportByWorker(req.user, dto);
  }

  // ---------- 主管：确认工伤事件 ----------
  @Roles('SUPERVISOR', 'ENTERPRISE')
  @Post('injuries/:id/supervisor-review')
  supervisorReview(
    @Param('id') id: string,
    @Body() dto: { approve: boolean; note?: string },
    @Req() req: any,
  ) {
    return this.svc.supervisorReview(req.user, Number(id), !!dto.approve, dto.note);
  }

  // ---------- 客服：发起保险报案 ----------
  @Roles('SUPPORT')
  @Post('injuries/:id/report-insurance')
  fileReport(
    @Param('id') id: string,
    @Body() dto: { claimAmount?: number; note?: string },
    @Req() req: any,
  ) {
    return this.svc.fileReport(req.user, Number(id), dto);
  }

  // ---------- 工伤任务：日结工资先按已完成工时结算 ----------
  @Roles('SUPPORT', 'ENTERPRISE')
  @Post('injuries/:id/settle-wages')
  settleWages(@Param('id') id: string, @Req() req: any) {
    return this.svc.settleWages(req.user, Number(id));
  }

  // ---------- 跟进：理赔资料 / 医院补票 / 主管补充 / 保险反馈 ----------
  @Post('injuries/:id/followups')
  addFollowup(
    @Param('id') id: string,
    @Body() dto: { type: any; content: string; attachments?: string; amount?: number },
    @Req() req: any,
  ) {
    return this.svc.addFollowup(req.user, Number(id), dto);
  }

  // ---------- 客服：更新理赔资料清单 ----------
  @Roles('SUPPORT')
  @Post('injuries/:id/materials')
  updateMaterials(
    @Param('id') id: string,
    @Body() dto: { patch: any; note?: string },
    @Req() req: any,
  ) {
    return this.svc.updateMaterials(req.user, Number(id), dto.patch || {}, dto.note);
  }

  // ---------- 企业：提交责任意见 ----------
  @Roles('ENTERPRISE', 'SUPERVISOR')
  @Post('injuries/:id/enterprise-opinion')
  enterpriseOpinion(
    @Param('id') id: string,
    @Body() dto: { opinion: string; acceptedPct?: number },
    @Req() req: any,
  ) {
    return this.svc.submitEnterpriseOpinion(req.user, Number(id), dto);
  }

  // ---------- 医疗垫付登记（企业/平台）与追回处理（客服） ----------
  @Roles('SUPPORT', 'ENTERPRISE')
  @Post('injuries/:id/advance')
  registerAdvance(
    @Param('id') id: string,
    @Body() dto: { source: any; amount: number; note?: string },
    @Req() req: any,
  ) {
    return this.svc.registerAdvance(req.user, Number(id), dto);
  }

  @Roles('SUPPORT')
  @Post('injuries/:id/advance/resolve')
  resolveAdvance(
    @Param('id') id: string,
    @Body() dto: { status: 'RECOVERED' | 'WAIVED'; note?: string },
    @Req() req: any,
  ) {
    return this.svc.resolveAdvance(req.user, Number(id), dto);
  }

  // ---------- 客服：责任判定 ----------
  @Roles('SUPPORT')
  @Post('injuries/:id/liability')
  decideLiability(
    @Param('id') id: string,
    @Body() dto: { liability: any; enterprisePct?: number; note?: string },
    @Req() req: any,
  ) {
    return this.svc.decideLiability(req.user, Number(id), dto);
  }

  // ---------- 客服：追查考勤缺失对理赔的影响 ----------
  @Roles('SUPPORT')
  @Post('injuries/:id/attendance-gap')
  traceAttendanceGap(
    @Param('id') id: string,
    @Body() dto: { result: any; note?: string },
    @Req() req: any,
  ) {
    return this.svc.traceAttendanceGap(req.user, Number(id), dto);
  }

  // ---------- 客服：结案 ----------
  @Roles('SUPPORT')
  @Post('injuries/:id/close')
  close(
    @Param('id') id: string,
    @Body() dto: { outcome: 'SETTLED' | 'CLOSED'; payoutAmount?: number; note?: string },
    @Req() req: any,
  ) {
    return this.svc.close(req.user, Number(id), dto);
  }

  // ---------- 查询 ----------
  @Get('injuries/:id')
  detail(@Param('id') id: string) {
    return this.svc.detail(Number(id));
  }

  @Get('assignments/:id/injuries')
  byAssignment(@Param('id') id: string) {
    return this.svc.listForAssignment(Number(id));
  }

  @Roles('SUPPORT')
  @Get('support/injuries')
  listSupport() {
    return this.svc.listForSupport();
  }

  @Roles('SUPPORT')
  @Get('support/injuries/stats')
  supportStats() {
    return this.svc.supportStats();
  }

  @Roles('ENTERPRISE', 'SUPERVISOR')
  @Get('enterprise/injuries')
  listEnterprise(@Req() req: any) {
    return this.svc.listForEnterprise(req.user.enterpriseId);
  }

  @Roles('WORKER')
  @Get('my/injuries')
  listMine(@Req() req: any) {
    return this.svc.listForWorker(req.user.sub);
  }
}
