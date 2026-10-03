import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  InjuryClaim, ClaimFollowUp, JobEvent, Assignment, Job, AttendanceEvent,
  InsurancePolicy, User, Enterprise, Settlement,
} from '../../entities';
import { SettlementService } from '../settlements/settlement.service';

type Actor = { sub: number; role: string; name: string; enterpriseId?: number | null };

const asList = (v: string | null | undefined): string[] =>
  (v || '').split(',').map((s) => s.trim()).filter(Boolean);

@Injectable()
export class ClaimsService {
  constructor(
    @InjectRepository(InjuryClaim) private claims: Repository<InjuryClaim>,
    @InjectRepository(ClaimFollowUp) private followUps: Repository<ClaimFollowUp>,
    @InjectRepository(JobEvent) private jobEvents: Repository<JobEvent>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    private settlementService: SettlementService,
  ) {}

  // ===================== 列表 =====================
  private async enrich(c: InjuryClaim) {
    const [worker, enterprise, job, event, settlement] = await Promise.all([
      this.users.findOne({ where: { id: c.workerId } }),
      this.enterprises.findOne({ where: { id: c.enterpriseId } }),
      this.jobs.findOne({ where: { id: c.jobId } }),
      this.jobEvents.findOne({ where: { id: c.jobEventId } }),
      c.wageSettlementId
        ? this.settlements.findOne({ where: { id: c.wageSettlementId } })
        : this.settlements.findOne({ where: { assignmentId: c.assignmentId } }),
    ]);
    const pendingCount = await this.followUps.count({ where: { claimId: c.id } });
    return {
      ...c,
      scenePhotos: asList(c.scenePhotoUrls),
      medicalReceipts: asList(c.medicalReceiptUrls),
      workerName: worker?.name || `#${c.workerId}`,
      workerPhone: worker?.phone,
      enterpriseName: enterprise?.name || `#${c.enterpriseId}`,
      jobTitle: job?.title,
      jobIndustry: job?.industry,
      eventStatus: event?.status,
      settlementStatus: settlement?.status || null,
      workerPayable: settlement?.workerPayable ?? null,
      followUpCount: pendingCount,
    };
  }

  async listAll() {
    const list = await this.claims.find({ order: { id: 'DESC' } });
    return Promise.all(list.map((c) => this.enrich(c)));
  }

  async listForEnterprise(enterpriseId: number) {
    const list = await this.claims.find({ where: { enterpriseId }, order: { id: 'DESC' } });
    return Promise.all(list.map((c) => this.enrich(c)));
  }

  async listForWorker(workerId: number) {
    const list = await this.claims.find({ where: { workerId }, order: { id: 'DESC' } });
    return Promise.all(list.map((c) => this.enrich(c)));
  }

  // ===================== 详情（含证据与跟进时间线） =====================
  async detail(claimId: number, actor?: Actor) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (actor) {
      if (actor.role === 'WORKER' && actor.sub !== claim.workerId) throw new ForbiddenException();
      if ((actor.role === 'ENTERPRISE' || actor.role === 'SUPERVISOR') && actor.enterpriseId !== claim.enterpriseId) {
        throw new ForbiddenException('只能查看本企业的工伤理赔单');
      }
    }
    const [event, assignment, job, policy, atts, settlement, followUps] = await Promise.all([
      this.jobEvents.findOne({ where: { id: claim.jobEventId } }),
      this.assignments.findOne({ where: { id: claim.assignmentId } }),
      this.jobs.findOne({ where: { id: claim.jobId } }),
      this.policies.findOne({ where: { assignmentId: claim.assignmentId } }),
      this.attendance.find({ where: { assignmentId: claim.assignmentId }, order: { eventTime: 'ASC' } }),
      this.settlements.findOne({ where: { assignmentId: claim.assignmentId } }),
      this.followUps.find({ where: { claimId }, order: { id: 'ASC' } }),
    ]);
    return {
      claim: await this.enrich(claim),
      jobEvent: event,
      assignment,
      job,
      policy,
      attendanceAnalysis: this.analyzeAttendance(atts, policy),
      settlement,
      followUps,
    };
  }

  /** 追查考勤缺失：企业未按要求确认到岗，会直接影响保险是否在事故时生效（理赔举证不利） */
  private analyzeAttendance(atts: AttendanceEvent[], policy: InsurancePolicy | null) {
    const checkIns = atts.filter((a) => a.kind === 'CHECK_IN');
    const passed = checkIns.find((a) => a.allPassed);
    const retro = checkIns.find((a) => a.retroRecognized && !a.allPassed);
    const unconfirmed = checkIns.find((a) => !a.allPassed && !a.retroRecognized && a.locationPassed && a.facePassed && a.qrcodePassed);
    const issues: string[] = [];
    if (passed) {
      return {
        hasPassedCheckIn: true,
        issue: false,
        conclusion: `四重到岗校验已于 ${new Date(passed.eventTime).toLocaleString('zh-CN')} 完成，考勤完整，保险锚定该时间生效`,
        issues,
      };
    }
    if (retro) {
      issues.push('企业主管当时未在系统确认到岗，平台事后追查依据三要素/现场证据认定工人实际到岗（仅用于工资结算与责任认定）');
      issues.push('保险生效时间不因事后认定而追溯——事故时保险未生效，保险仍不可赔');
      return {
        hasPassedCheckIn: false,
        retroRecognized: true,
        issue: true,
        conclusion: '考勤缺失已追查：认定工人实际到岗可按工时结算工资，但保险不追溯生效',
        issues,
      };
    }
    if (unconfirmed) {
      issues.push('工人已完成定位/人脸/二维码三要素，但现场主管未在系统中确认实际到岗');
      if (policy && policy.status !== 'ACTIVE') {
        issues.push('因主管未确认，保险未在事故前生效——企业未按要求确认到岗，在理赔中承担举证不利后果');
      }
    } else if (checkIns.length) {
      issues.push('存在签到尝试但四重校验未全部通过（定位/人脸/二维码异常）');
    } else {
      issues.push('系统中无任何到岗签到记录，无法证明事故时工人已实际到岗');
    }
    return {
      hasPassedCheckIn: false,
      issue: true,
      conclusion: '考勤链不完整：平台已就「企业未按要求确认到岗」对理赔的影响立案追查',
      issues,
    };
  }

  private addFollow(claimId: number, type: ClaimFollowUp['type'], content: string, actor: Actor | null, extra: Partial<ClaimFollowUp> = {}) {
    return this.followUps.save(this.followUps.create({
      claimId,
      type,
      content,
      operatorId: actor?.sub ?? 0,
      operatorRole: actor?.role ?? 'SYSTEM',
      operatorName: actor?.name ?? '系统',
      ...extra,
    }));
  }

  private appendNote(claim: InjuryClaim, line: string) {
    claim.adjusterNote = `${claim.adjusterNote || ''}\n${line}`.trim();
  }

  // ===================== 客服：发起保险报案 =====================
  async report(actor: Actor, claimId: number, dto: {
    insurerReportNo?: string; note?: string; platformVerified?: boolean;
  }) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (claim.reportedToInsurer) throw new BadRequestException('该理赔单已向保险公司报案，请勿重复报案');
    if (!claim.supervisorConfirmed && !dto.platformVerified) {
      throw new BadRequestException('主管尚未确认工伤事实：请先督促现场主管确认；若企业拒不确认，须先完成考勤缺失追查并勾选平台核实后再报案留档');
    }
    if (!claim.supervisorConfirmed && dto.platformVerified && !claim.attendanceCheckedAt) {
      throw new BadRequestException('平台核实代报案前必须先完成考勤缺失追查');
    }
    claim.reportedToInsurer = true;
    claim.reportedBy = actor.sub;
    claim.reportedAt = new Date();
    claim.insurerReportNo = dto.insurerReportNo?.trim() || `BX${String(claim.id).padStart(6, '0')}`;
    claim.status = 'REPORTED';
    this.appendNote(claim,
      `客服 ${actor.name} 发起保险报案（报案号 ${claim.insurerReportNo}）：${dto.note || '依据事故记录六要素报案'}`
      + (!claim.supervisorConfirmed ? '；主管未确认，平台经考勤追查核实后代为立案' : '')
      + `${claim.coveredAtOccurrence ? '' : '；注意事故时保险未生效，报案仅作留档，保险预计拒赔，医疗垫付与责任另案跟进'}`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'REPORT',
      `客服向保险公司发起报案，报案号 ${claim.insurerReportNo}`, actor, {
        nextAction: claim.coveredAtOccurrence ? '催收齐理赔资料（病历/诊断证明/就医票据）' : '保险预计拒赔，跟进医疗垫付与企业责任判定',
      });
    return this.detail(claimId);
  }

  // ===================== 客服：理赔资料 / 医院补票 =====================
  async trackMaterials(actor: Actor, claimId: number, dto: {
    complete: boolean; note: string; receiptUrls?: string; missingItems?: string;
  }) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (!dto.note?.trim()) throw new BadRequestException('请填写资料跟进说明');

    const receipts = asList(dto.receiptUrls);
    if (receipts.length) {
      const merged = Array.from(new Set([...asList(claim.medicalReceiptUrls), ...receipts]));
      claim.medicalReceiptUrls = merged.join(',');
    }
    claim.materialsComplete = !!dto.complete;
    claim.materialsNote = dto.note.trim();
    claim.status = dto.complete
      ? (claim.reportedToInsurer ? 'INVESTIGATING' : claim.status)
      : 'MATERIALS_PENDING';
    this.appendNote(claim, `理赔资料跟进：${dto.note}${receipts.length ? `（新增医院补票 ${receipts.length} 张）` : ''}${dto.missingItems ? `；缺：${dto.missingItems}` : ''}`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, receipts.length ? 'RECEIPT' : 'MATERIAL',
      receipts.length
        ? `医院补票到账 ${receipts.length} 张：${dto.note}`
        : `理赔资料跟进：${dto.note}`, actor, {
        attachmentUrls: receipts.join(',') || null,
        nextAction: dto.complete ? '资料齐套，等待保险公司核定' : `催补资料：${dto.missingItems || '病历/诊断证明/票据'}`,
      });
    return this.detail(claimId);
  }

  // ===================== 客服：医疗垫付（与工资解耦，单独跟进） =====================
  async medicalAdvance(actor: Actor, claimId: number, dto: {
    amount: number; by: 'PLATFORM' | 'ENTERPRISE' | 'INSURER'; note?: string; receiptUrls?: string;
  }) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    const amount = Math.max(0, Number(dto.amount) || 0);
    if (amount <= 0) throw new BadRequestException('垫付金额必须大于 0');
    if (!['PLATFORM', 'ENTERPRISE', 'INSURER'].includes(dto.by)) throw new BadRequestException('垫付方无效');

    const receipts = asList(dto.receiptUrls);
    if (receipts.length) {
      claim.medicalReceiptUrls = Array.from(new Set([...asList(claim.medicalReceiptUrls), ...receipts])).join(',');
    }
    claim.medicalAdvanceAmount = Number((Number(claim.medicalAdvanceAmount) + amount).toFixed(2));
    claim.medicalAdvanceBy = dto.by;
    claim.medicalAdvanceAt = new Date();
    claim.medicalAdvanceNote = dto.note?.trim() || null;
    this.appendNote(claim, `${byLabel(dto.by)}垫付医疗费 ¥${amount.toFixed(2)}：${dto.note || '凭就医票据垫付，后续向责任方/保险追偿'}`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'MEDICAL_ADVANCE',
      `${byLabel(dto.by)}垫付医疗费 ¥${amount.toFixed(2)}（累计 ¥${claim.medicalAdvanceAmount}），垫付与日结工资分开跟进、后续追偿`,
      actor, { attachmentUrls: receipts.join(',') || null, nextAction: '保留票据，待责任判定/保险核定后追偿' });
    return this.detail(claimId);
  }

  // ===================== 客服：追查企业考勤缺失 =====================
  async checkAttendance(actor: Actor, claimId: number, dto: {
    note: string; enterpriseAtFault?: boolean; recognizeArrival?: boolean;
  }) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (!dto.note?.trim()) throw new BadRequestException('请填写考勤追查结论');
    const atts = await this.attendance.find({ where: { assignmentId: claim.assignmentId }, order: { eventTime: 'ASC' } });
    const policy = await this.policies.findOne({ where: { assignmentId: claim.assignmentId } });
    const analysis = this.analyzeAttendance(atts, policy);

    // 事后认定实际到岗：仅用于工资结算与责任认定，保险生效时间绝不追溯
    let retroArrival: AttendanceEvent | null = null;
    if (dto.recognizeArrival) {
      const candidate = atts.find((a) => a.kind === 'CHECK_IN' && !a.allPassed && a.locationPassed && a.facePassed && a.qrcodePassed)
        || atts.find((a) => a.kind === 'CHECK_IN' && !a.allPassed);
      if (candidate) {
        candidate.retroRecognized = true;
        await this.attendance.save(candidate);
        retroArrival = candidate;
      }
    }

    claim.attendanceIssue = analysis.issue || !!dto.enterpriseAtFault;
    claim.attendanceNote = `${analysis.conclusion}\n追查意见：${dto.note.trim()}`
      + (retroArrival ? `\n平台认定工人实际到岗（签到 #${retroArrival.id}，时间 ${new Date(retroArrival.eventTime).toLocaleString('zh-CN')}），仅供工资/责任使用，保险不追溯生效` : '');
    claim.attendanceCheckedAt = new Date();
    if (dto.enterpriseAtFault && claim.liabilityResult === 'PENDING') {
      // 仅标记考勤责任线索，最终责任判定仍需走 liability 流程
      this.appendNote(claim, '考勤追查认定企业未按要求确认到岗，责任判定时作为企业举证不利依据');
    }
    this.appendNote(claim, `考勤缺失追查：${dto.note}`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'ATTENDANCE_CHECK',
      `考勤缺失追查：${dto.note}（系统分析：${analysis.conclusion}）`
      + (retroArrival ? '；平台已事后认定实际到岗，可按已完成工时结算工资，但保险不追溯' : ''),
      actor, {
        nextAction: analysis.issue ? '向企业发起到岗确认责任问询，结合企业责任意见判定责任' : '归档考勤核查结论',
      });
    return this.detail(claimId);
  }

  // ===================== 企业：提交责任意见（可多次补充） =====================
  async enterpriseOpinion(actor: Actor, claimId: number, opinion: string) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (actor.enterpriseId !== claim.enterpriseId) throw new ForbiddenException('只能对本企业的理赔单提交意见');
    if (!opinion?.trim()) throw new BadRequestException('请填写企业责任意见');
    claim.enterpriseOpinion = opinion.trim();
    claim.enterpriseOpinionAt = new Date();
    this.appendNote(claim, `企业责任意见：${opinion.trim()}`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'ENTERPRISE_OPINION', `企业提交责任意见：${opinion.trim()}`, {
      sub: actor.sub, role: 'ENTERPRISE', name: actor.name,
    } as Actor, { nextAction: '客服结合考勤、现场照片、票据综合判定责任' });
    return this.detail(claimId);
  }

  // ===================== 客服：责任判定（单独跟进，不与工资/保险混同） =====================
  async decideLiability(actor: Actor, claimId: number, dto: {
    result: InjuryClaim['liabilityResult']; note: string;
  }) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    const allowed: InjuryClaim['liabilityResult'][] = [
      'ENTERPRISE_LIABLE', 'WORKER_LIABLE', 'SHARED', 'NO_LIABILITY',
    ];
    if (!allowed.includes(dto.result)) throw new BadRequestException('责任判定结果无效');
    if (!dto.note?.trim()) throw new BadRequestException('请填写责任判定依据');
    claim.liabilityResult = dto.result;
    claim.liabilityNote = dto.note.trim();
    claim.liabilityDecidedBy = actor.sub;
    claim.liabilityDecidedAt = new Date();
    this.appendNote(claim, `平台责任判定：${liabilityLabel(dto.result)}。依据：${dto.note}`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'LIABILITY',
      `平台完成责任判定：${liabilityLabel(dto.result)}。${dto.note}`, actor, {
        nextAction: dto.result === 'ENTERPRISE_LIABLE' || dto.result === 'SHARED'
          ? '按责任比例向企业追偿医疗垫付/保险免赔部分'
          : '向工人说明判定结论与救济途径',
      });
    return this.detail(claimId);
  }

  // ===================== 客服：日结工资按已完成工时先行结算 =====================
  async settleWage(actor: Actor, claimId: number) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    const existing = await this.settlements.findOne({ where: { assignmentId: claim.assignmentId } });
    if (existing && ['PAID', 'ADJUSTED'].includes(existing.status)) {
      throw new BadRequestException(`该任务日结工资已 ${existing.status === 'PAID' ? '发放' : '调整结案'}，无需重复结算`);
    }
    // 必须已有有效到岗记录（或平台事后追查认定的实际到岗），否则没有"已完成工时"可结
    const passed = await this.attendance.findOne({
      where: { assignmentId: claim.assignmentId, kind: 'CHECK_IN', allPassed: true },
    }) ?? await this.attendance.findOne({
      where: { assignmentId: claim.assignmentId, kind: 'CHECK_IN', retroRecognized: true },
    });
    if (!passed) throw new BadRequestException('无有效到岗记录，无法按已完成工时结算，请先追查考勤');

    const settlement = await this.settlementService.generateForInjury(claim.assignmentId);
    claim.wageSettlementId = settlement.id;
    claim.wageSettledAt = new Date();
    this.appendNote(claim, `日结工资按已完成工时 ${settlement.workMinutes} 分钟先行结算 ¥${settlement.workerPayable}（工资与医疗/责任/保险分开跟进）`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'WAGE_SETTLED',
      `日结工资先行结算：已完成工时 ${settlement.workMinutes} 分钟，应发 ¥${settlement.workerPayable}，等待企业确认发放；工伤理赔与责任判定继续跟进，不因工资结清而关单`,
      actor, { nextAction: '通知企业确认发放工资；理赔资料/医疗垫付/责任继续跟进' });
    return this.detail(claimId);
  }

  // ===================== 客服：保险核定（covered 不可变，禁止改赔） =====================
  async adjust(actor: Actor, claimId: number, approve: boolean, note: string) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (!note?.trim()) throw new BadRequestException('请填写核定依据');
    if (approve && !claim.coveredAtOccurrence) {
      throw new BadRequestException('事故发生时保险未生效，禁止赔付——平台不允许事故后补录保险');
    }
    if (!claim.reportedToInsurer && approve) {
      throw new BadRequestException('尚未向保险公司报案，不能直接核定赔付');
    }
    claim.status = approve ? 'APPROVED' : 'REJECTED';
    this.appendNote(claim, `保险核定：${approve ? '赔付' : '拒赔'}。${note}`);
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'ADJUST',
      `保险公司核定结论：${approve ? `同意赔付 ¥${Number(claim.claimAmount).toFixed(2)}` : '拒赔'}。${note}`,
      actor, { nextAction: approve ? '跟踪赔款到账后可结案' : '如企业有责，转入责任追偿；工人侧医疗垫付继续跟进' });
    return this.detail(claimId);
  }

  // ===================== 客服：普通备注 =====================
  async addNote(actor: Actor, claimId: number, content: string, nextAction?: string) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (!content?.trim()) throw new BadRequestException('备注内容不能为空');
    const saved = await this.addFollow(claim.id, 'NOTE', content.trim(), actor, {
      nextAction: nextAction?.trim() || null,
    });
    return saved;
  }

  // ===================== 工人：医院补票（资料持续跟踪） =====================
  async workerAddReceipts(actor: Actor, claimId: number, receiptUrls: string, note?: string) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (actor.sub !== claim.workerId) throw new ForbiddenException('只能为本人工伤单补充票据');
    const receipts = asList(receiptUrls);
    if (!receipts.length) throw new BadRequestException('请上传至少一张就医票据');
    claim.medicalReceiptUrls = Array.from(new Set([...asList(claim.medicalReceiptUrls), ...receipts])).join(',');
    claim.materialsComplete = false;
    claim.materialsNote = '工人补充医院票据，待客服核验齐套';
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'RECEIPT',
      `工人补充医院就医票据 ${receipts.length} 张：${note || '挂号/检查/药品费用'}`, actor, {
        attachmentUrls: receipts.join(','), nextAction: '客服核验票据并更新理赔资料清单',
      });
    return this.detail(claimId);
  }

  // ===================== 客服：结案（工资已结 + 医疗/责任有去向） =====================
  async close(actor: Actor, claimId: number, note: string) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    if (!note?.trim()) throw new BadRequestException('请填写结案说明');
    if (!claim.wageSettledAt && !(await this.settlements.findOne({ where: { assignmentId: claim.assignmentId } }))) {
      throw new BadRequestException('日结工资尚未按已完成工时结算，不能结案（工资可先行结算，理赔继续跟进）');
    }
    if (claim.liabilityResult === 'PENDING') {
      throw new BadRequestException('责任尚未判定，不能结案——医疗垫付与责任判定须有明确去向');
    }
    if (Number(claim.medicalAdvanceAmount) > 0 && claim.status === 'REJECTED' && claim.liabilityResult === 'WORKER_LIABLE') {
      throw new BadRequestException('存在医疗垫付、保险拒赔且判定工人自身责任，请先明确垫付承担/追偿去向后再结案');
    }
    claim.status = 'CLOSED';
    claim.closedAt = new Date();
    claim.closeNote = note.trim();
    await this.claims.save(claim);
    await this.addFollow(claim.id, 'CLOSE', `整件结案：${note}`, actor);
    return this.detail(claimId);
  }
}

function byLabel(by: string) {
  return ({ PLATFORM: '平台', ENTERPRISE: '企业', INSURER: '保险方' } as Record<string, string>)[by] || by;
}

export function liabilityLabel(r: string) {
  return ({
    PENDING: '待判定',
    ENTERPRISE_LIABLE: '企业全责',
    WORKER_LIABLE: '工人自身原因',
    SHARED: '双方分担',
    NO_LIABILITY: '意外无责',
  } as Record<string, string>)[r] || r;
}
