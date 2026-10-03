import {
  Body, Controller, Get, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles, RoleGuard } from '../auth/auth.guard';
import { ClaimsService } from './claims.service';

@Controller('api/claims')
@UseGuards(AuthGuard, RoleGuard)
export class ClaimsController {
  constructor(private claims: ClaimsService) {}

  // 客服：全部工伤理赔单
  @Roles('SUPPORT')
  @Get()
  listAll() {
    return this.claims.listAll();
  }

  // 工人：本人的工伤单
  @Roles('WORKER')
  @Get('my')
  listMine(@Req() req: any) {
    return this.claims.listForWorker(req.user.sub);
  }

  // 企业：本企业工伤单
  @Roles('ENTERPRISE', 'SUPERVISOR')
  @Get('enterprise')
  listEnt(@Req() req: any) {
    return this.claims.listForEnterprise(req.user.enterpriseId);
  }

  // 详情（按角色限权）：六要素、考勤分析、保单、结算、跟进时间线
  @Get(':id')
  detail(@Param('id') id: string, @Req() req: any) {
    return this.claims.detail(Number(id), req.user);
  }

  // 客服：发起保险报案
  @Roles('SUPPORT')
  @Post(':id/report')
  report(@Param('id') id: string, @Body() dto: { insurerReportNo?: string; note?: string; platformVerified?: boolean }, @Req() req: any) {
    return this.claims.report(req.user, Number(id), dto);
  }

  // 客服：理赔资料 / 医院补票
  @Roles('SUPPORT')
  @Post(':id/materials')
  materials(@Param('id') id: string, @Body() dto: { complete: boolean; note: string; receiptUrls?: string; missingItems?: string }, @Req() req: any) {
    return this.claims.trackMaterials(req.user, Number(id), dto);
  }

  // 客服：医疗垫付（与工资解耦）
  @Roles('SUPPORT')
  @Post(':id/medical-advance')
  advance(@Param('id') id: string, @Body() dto: { amount: number; by: 'PLATFORM' | 'ENTERPRISE' | 'INSURER'; note?: string; receiptUrls?: string }, @Req() req: any) {
    return this.claims.medicalAdvance(req.user, Number(id), dto);
  }

  // 客服：追查企业考勤缺失对理赔的影响
  @Roles('SUPPORT')
  @Post(':id/attendance-check')
  attendance(@Param('id') id: string, @Body() dto: { note: string; enterpriseAtFault?: boolean; recognizeArrival?: boolean }, @Req() req: any) {
    return this.claims.checkAttendance(req.user, Number(id), dto);
  }

  // 客服：日结工资按已完成工时先行结算
  @Roles('SUPPORT')
  @Post(':id/settle-wage')
  settleWage(@Param('id') id: string, @Req() req: any) {
    return this.claims.settleWage(req.user, Number(id));
  }

  // 客服：责任判定
  @Roles('SUPPORT')
  @Post(':id/liability')
  liability(@Param('id') id: string, @Body() dto: { result: any; note: string }, @Req() req: any) {
    return this.claims.decideLiability(req.user, Number(id), dto);
  }

  // 客服：保险核定（赔付/拒赔，事故时未生效不可改赔）
  @Roles('SUPPORT')
  @Post(':id/adjust')
  adjust(@Param('id') id: string, @Body() dto: { approve: boolean; note: string }, @Req() req: any) {
    return this.claims.adjust(req.user, Number(id), !!dto.approve, dto.note);
  }

  // 客服：追加备注/下一待办
  @Roles('SUPPORT')
  @Post(':id/notes')
  note(@Param('id') id: string, @Body() dto: { content: string; nextAction?: string }, @Req() req: any) {
    return this.claims.addNote(req.user, Number(id), dto.content, dto.nextAction);
  }

  // 客服：结案
  @Roles('SUPPORT')
  @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: { note: string }, @Req() req: any) {
    return this.claims.close(req.user, Number(id), dto.note);
  }

  // 企业：提交责任意见
  @Roles('ENTERPRISE', 'SUPERVISOR')
  @Post(':id/enterprise-opinion')
  opinion(@Param('id') id: string, @Body() dto: { opinion: string }, @Req() req: any) {
    return this.claims.enterpriseOpinion(req.user, Number(id), dto.opinion);
  }

  // 工人：补充医院就医票据
  @Roles('WORKER')
  @Post(':id/receipts')
  receipts(@Param('id') id: string, @Body() dto: { receiptUrls: string; note?: string }, @Req() req: any) {
    return this.claims.workerAddReceipts(req.user, Number(id), dto.receiptUrls, dto.note);
  }
}
