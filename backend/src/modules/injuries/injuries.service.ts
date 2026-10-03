import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, InjuryCase, InjuryCaseFollowup, Settlement,
} from '../../entities';
import { EnterpriseService } from '../enterprise/enterprise.service';
import { SettlementService } from '../settlements/settlement.service';

const STALE_HOURS = 48; // 报案/跟进后超过 48 小时无新进展 → 平台标记停滞，防止无人跟进

const emptyMaterials = (supervisorConfirmed: boolean): InjuryClaim['materials'] => ({
  accidentNotice: false,
  medicalRecord: false,
  receipts: false,
  attendanceProof: false,
  supervisorStatement: supervisorConfirmed,
  enterpriseOpinion: false,
  idCopy: false,
});

@Injectable()
export class InjuryCasesService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    @InjectRepository(JobEvent) private jobEvents: Repository<JobEvent>,
    @InjectRepository(InjuryClaim) private claims: Repository<InjuryClaim>,
    @InjectRepository(InjuryCase) private cases: Repository<InjuryCase>,
    @InjectRepository(InjuryCaseFollowup) private followups: Repository<InjuryCaseFollowup>,
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    private entService: EnterpriseService,
    private settlementService: SettlementService,
  ) {}

  // ===================== 工人：现场记录工伤事件 =====================
  async reportByWorker(
    user: { sub: number; name: string },
    dto: {
      assignmentId: number;
      injuryDesc: string;
      positionAtInjury?: string;
      scenePhotos?: string;
      hospital?: string;
      medicalReceipts?: string;
      medicalExpense?: number;
    },
  ) {
    const assignment = await this.assignments.findOne({ where: { id: Number(dto.assignmentId), workerId: user.sub } });
    if (!assignment) throw new ForbiddenException('派单不存在或不属于当前工人');
    // WORKING/CHECKED_IN：正常作业中事故；ACCEPTED：工人称已到岗但企业未按要求完成到岗确认，
    // 仍允许记录事故（平台不能让考勤缺失导致事故无法记录），但会标记考勤缺失、事故时保险不生效
    if (!['WORKING', 'CHECKED_IN', 'ACCEPTED'].includes(assignment.status)) {
      throw new BadRequestException('当前任务状态不能记录工伤事件（需已被企业录取且在岗位现场）');
    }
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    if (!dto.injuryDesc?.trim()) throw new BadRequestException('请描述受伤经过与伤情');

    const dup = await this.cases.findOne({
      where: { assignmentId: assignment.id },
    });
    if (dup && !['CLOSED'].includes(dup.status)) {
      throw new BadRequestException('该任务已有进行中的工伤事件记录，请勿重复上报，可在案件中补充资料');
    }

    // 事故时间 = 服务器时间，现场实时上报，禁止事后补录
    const occurredAt = new Date();

    // 作业事件留痕（与任务内其他事件同一链路）
    const event = await this.jobEvents.save(this.jobEvents.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId: user.sub,
      type: 'INJURY',
      description: dto.injuryDesc.trim(),
      occurredAt,
      photoUrl: dto.scenePhotos?.split(',')[0] || null,
      lat: Number(job.lat),
      lng: Number(job.lng),
      status: 'PENDING',
    }));

    // 事故时点保险状态（不可变快照）
    const policy = await this.policies.findOne({ where: { assignmentId: assignment.id } });
    const covered = !!policy && this.isCoveredAt(policy, occurredAt);

    // 考勤缺失：事故时没有四重通过的到岗记录（企业未按要求确认到岗）
    const passedCheckIn = await this.attendance.findOne({
      where: { assignmentId: assignment.id, kind: 'CHECK_IN', allPassed: true },
    });
    const attendanceGap = !passedCheckIn;

    const entity = this.cases.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId: user.sub,
      enterpriseId: job.enterpriseId,
      jobEventId: event.id,
      status: 'DRAFT',
      occurredAt,
      positionAtInjury: dto.positionAtInjury?.trim() || job.title,
      injuryDesc: dto.injuryDesc.trim(),
      scenePhotos: dto.scenePhotos || null,
      hospital: dto.hospital?.trim() || null,
      medicalReceipts: dto.medicalReceipts || null,
      medicalExpense: Math.max(0, Number(dto.medicalExpense) || 0),
      insurancePolicyId: policy?.id ?? null,
      coveredAtOccurrence: covered,
      policyStatusAtOccurrence: policy?.status || null,
      attendanceGap,
      attendanceGapResult: attendanceGap ? 'PENDING' : 'CONFIRMED_ARRIVAL',
      advanceSource: 'NONE',
      advanceRecoveryStatus: 'N_A',
      liability: 'PENDING',
    });
    const injuryCase = await this.cases.save(entity);

    await this.addFollowupRecord(injuryCase.id, {
      type: 'STATUS',
      content: `工人现场记录工伤事件：${dto.injuryDesc.trim()}；岗位：${entity.positionAtInjury}` +
        `${dto.hospital ? `；就医医院：${dto.hospital}` : ''}` +
        `${attendanceGap ? '；⚠️ 事故时缺少四重通过的到岗考勤记录，平台将追查企业未确认到岗对理赔的影响' : ''}`,
      attachments: dto.scenePhotos || null,
      amount: entity.medicalExpense || null,
      actorId: user.sub, actorName: user.name, actorRole: 'WORKER',
    });

    return {
      injuryCase: await this.detail(injuryCase.id),
      message: '工伤事件已现场记录（事故时间取平台服务器时间，不可事后补录），等待现场主管确认',
    };
  }

  // ===================== 主管确认工伤事件 =====================
  async supervisorReview(
    user: { sub: number; role: string; name: string; enterpriseId?: number | null },
    caseId: number,
    approve: boolean,
    note?: string,
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    const job = await this.jobs.findOne({ where: { id: injuryCase.jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    if (user.enterpriseId !== job.enterpriseId) throw new ForbiddenException('只能确认本企业岗位的工伤事件');
    if (injuryCase.status !== 'DRAFT' && injuryCase.status !== 'DISPUTED') {
      throw new BadRequestException('该工伤事件已完成主管确认');
    }

    injuryCase.supervisorConfirmed = approve;
    injuryCase.confirmedBySupervisorId = user.sub;
    injuryCase.confirmedAt = new Date();
    injuryCase.supervisorNote = note?.trim() || null;
    injuryCase.status = approve ? 'CONFIRMED' : 'DISPUTED';
    await this.cases.save(injuryCase);

    // 同步作业事件审批状态
    if (injuryCase.jobEventId) {
      const ev = await this.jobEvents.findOne({ where: { id: injuryCase.jobEventId } });
      if (ev && ev.status === 'PENDING') {
        ev.status = approve ? 'APPROVED' : 'REJECTED';
        ev.reviewedBy = user.sub;
        ev.reviewedAt = new Date();
        ev.reviewNote = note?.trim() || null;
        await this.jobEvents.save(ev);
      }
    }

    if (approve) {
      // 真实工伤计入企业风险画像（同一案件只计一次）
      if (!injuryCase.riskCounted) {
        const ent = await this.entService.get(job.enterpriseId);
        ent.injuryJobs += 1;
        await this.enterprises.save(ent);
        await this.entService.recomputeRisk(job.enterpriseId);
        injuryCase.riskCounted = true;
        await this.cases.save(injuryCase);
      }
    }

    await this.addFollowupRecord(injuryCase.id, {
      type: 'SUPERVISOR_NOTE',
      content: `现场主管${approve ? '确认工伤属实' : '对工伤事件提出异议'}：${note?.trim() || '无补充说明'}`,
      actorId: user.sub, actorName: user.name, actorRole: 'SUPERVISOR',
    });

    return this.detail(injuryCase.id);
  }

  // ===================== 客服：根据记录发起保险报案 =====================
  async fileReport(
    user: { sub: number; name: string },
    caseId: number,
    dto: { claimAmount?: number; note?: string },
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    if (!['CONFIRMED', 'DISPUTED', 'REPORTED', 'CLAIM_TRACKING'].includes(injuryCase.status)) {
      throw new BadRequestException('工伤事件尚待现场主管确认，不能报案');
    }
    if (injuryCase.injuryClaimId) {
      throw new BadRequestException('该工伤事件已发起保险报案，请勿重复报案');
    }

    const policy = injuryCase.insurancePolicyId
      ? await this.policies.findOne({ where: { id: injuryCase.insurancePolicyId } })
      : null;
    const covered = injuryCase.coveredAtOccurrence;
    const reportNo = `BX${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${injuryCase.id}`;

    // 理赔单：事故时未生效 → 保险侧直接拒赔且不可改赔；但案件继续跟进企业责任与医疗垫付
    const claim = await this.claims.save(this.claims.create({
      assignmentId: injuryCase.assignmentId,
      jobId: injuryCase.jobId,
      workerId: injuryCase.workerId,
      enterpriseId: injuryCase.enterpriseId,
      jobEventId: injuryCase.jobEventId || 0,
      insurancePolicyId: policy?.id ?? 0,
      injuryDesc: injuryCase.injuryDesc,
      claimAmount: Math.max(0, Number(dto.claimAmount) || injuryCase.medicalExpense || 5000),
      status: covered ? 'REPORTED' : 'REJECTED',
      coveredAtOccurrence: covered,
      adjusterNote: covered
        ? `客服根据工伤记录发起保险报案（报案号 ${reportNo}），进入理赔资料跟进`
        : `事故发生时保险未生效（保单状态 ${injuryCase.policyStatusAtOccurrence || '无保单'}），保险不予赔付且禁止事后补录；` +
          `医疗垫付与企业责任由平台另案跟进${injuryCase.attendanceGap ? '（企业未按要求确认到岗，平台追查中）' : ''}`,
      insurerReportNo: reportNo,
      reportedAt: new Date(),
      reportedBy: user.sub,
      materials: emptyMaterials(!!injuryCase.supervisorConfirmed),
      hospitalReceiptStatus: injuryCase.medicalReceipts ? 'NOT_NEEDED' : 'PENDING',
      attendanceGapFlag: injuryCase.attendanceGap,
      lastFollowupAt: new Date(),
    }));

    injuryCase.injuryClaimId = claim.id;
    injuryCase.insurerReportNo = reportNo;
    injuryCase.reportedBy = user.sub;
    injuryCase.reportedAt = new Date();
    injuryCase.reportNote = dto.note?.trim() || null;
    injuryCase.status = covered ? 'CLAIM_TRACKING' : 'REPORTED';
    await this.cases.save(injuryCase);

    await this.addFollowupRecord(injuryCase.id, {
      type: 'INSURER',
      content: `客服发起保险报案，报案号 ${reportNo}；` +
        (covered
          ? `保险在保障期内，立案跟进理赔资料（预估索赔 ¥${claim.claimAmount}）`
          : '事故时保险未生效，保险公司拒赔（不可事后补录），转入企业责任与医疗垫付跟进'),
      actorId: user.sub, actorName: user.name, actorRole: 'SUPPORT',
    });

    if (injuryCase.attendanceGap && injuryCase.attendanceGapResult === 'PENDING') {
      await this.addFollowupRecord(injuryCase.id, {
        type: 'ATTENDANCE_TRACE',
        content: '平台追查：事故时缺少四重通过的到岗考勤记录，需向企业核实是否未按要求确认工人到岗，'
          + '并评估考勤缺失对理赔的影响（企业承认实际到岗的，由企业承担保险缺口的不利后果）',
        actorId: user.sub, actorName: user.name, actorRole: 'SUPPORT',
      });
    }

    return this.detail(injuryCase.id);
  }

  // ===================== 工伤日结：先按已完成工时结算（医疗/责任另案） =====================
  async settleWages(
    user: { sub: number; role: string; name: string; enterpriseId?: number | null },
    caseId: number,
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    const job = await this.jobs.findOne({ where: { id: injuryCase.jobId } });
    if (user.role === 'ENTERPRISE' && user.enterpriseId !== job.enterpriseId) {
      throw new ForbiddenException('只能处理本企业任务的结算');
    }
    if (user.role === 'SUPERVISOR') throw new ForbiddenException();

    const existing = await this.settlements.findOne({ where: { assignmentId: injuryCase.assignmentId } });
    if (existing && ['PAID', 'ADJUSTED'].includes(existing.status)) {
      throw new BadRequestException('该任务日结工资已发放完成（工伤理赔与责任仍单独跟进，不受工资结清影响）');
    }
    if (injuryCase.attendanceGap && injuryCase.attendanceGapResult === 'PENDING') {
      throw new BadRequestException('事故时缺少有效到岗考勤且尚未完成追查：请先追查企业未确认到岗的事实，再按认定到岗时间结算工资');
    }
    const checkout = await this.attendance.findOne({
      where: { assignmentId: injuryCase.assignmentId, kind: 'CHECK_OUT', allPassed: true },
    });
    const genOpts: { injuryStopAt?: Date; assumedStartAt?: Date } = {};
    if (!checkout) genOpts.injuryStopAt = injuryCase.occurredAt;
    // 考勤缺失但平台追查认定工人实际到岗：以认定到岗时间（开工时间）为结算起点
    if (injuryCase.attendanceGap && injuryCase.attendanceGapResult === 'CONFIRMED_ARRIVAL') {
      genOpts.assumedStartAt = new Date(job.startTime);
    }
    const settlement = await this.settlementService.generate(injuryCase.assignmentId, genOpts);

    await this.addFollowupRecord(injuryCase.id, {
      type: 'STATUS',
      content: `日结工资按已完成工时先行结算：有效工时 ${settlement.workMinutes} 分钟，`
        + `工人应发 ¥${settlement.workerPayable}；医疗垫付与责任判定不并入工资，单独跟进`,
      amount: Number(settlement.workerPayable),
      actorId: user.sub, actorName: user.name,
      actorRole: user.role === 'SUPPORT' ? 'SUPPORT' : 'ENTERPRISE',
    });

    return { settlement, injuryCase: await this.detail(caseId) };
  }

  // ===================== 跟进动作：资料 / 医院补票 / 主管补充 =====================
  async addFollowup(
    user: { sub: number; role: string; name: string; enterpriseId?: number | null },
    caseId: number,
    dto: { type: InjuryCaseFollowup['type']; content: string; attachments?: string; amount?: number },
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    const job = await this.jobs.findOne({ where: { id: injuryCase.jobId } });
    if (!dto.content?.trim()) throw new BadRequestException('请填写跟进内容');

    const isWorker = user.role === 'WORKER' && user.sub === injuryCase.workerId;
    const isEntSide = ['ENTERPRISE', 'SUPERVISOR'].includes(user.role) && user.enterpriseId === job.enterpriseId;
    const isSupport = user.role === 'SUPPORT';
    if (!isWorker && !isEntSide && !isSupport) throw new ForbiddenException('只有案件参与方可以添加跟进');

    const allowedByRole: Record<string, InjuryCaseFollowup['type'][]> = {
      WORKER: ['DOC_SUBMITTED', 'HOSPITAL_RECEIPT'],
      SUPERVISOR: ['SUPERVISOR_NOTE', 'DOC_SUBMITTED'],
      ENTERPRISE: ['ENTERPRISE_OPINION', 'ADVANCE', 'DOC_SUBMITTED'],
      SUPPORT: ['DOC_REQUIRED', 'DOC_SUBMITTED', 'HOSPITAL_RECEIPT', 'SUPERVISOR_NOTE',
        'ENTERPRISE_OPINION', 'ATTENDANCE_TRACE', 'ADVANCE', 'LIABILITY', 'INSURER', 'STATUS'],
    };
    if (!isSupport && !allowedByRole[user.role].includes(dto.type)) {
      throw new ForbiddenException('当前角色不能添加该类型跟进');
    }

    // 资料补充：工人/主管/企业提交后更新资料清单
    if (dto.type === 'DOC_SUBMITTED' && injuryCase.injuryClaimId) {
      const patch: Partial<NonNullable<InjuryClaim['materials']>> = {
        accidentNotice: true,
        medicalRecord: true,
        receipts: !!injuryCase.medicalReceipts,
      };
      if (isWorker) patch.idCopy = true;
      await this.patchMaterials(injuryCase, patch);
    }

    // 医院补票
    if (dto.type === 'HOSPITAL_RECEIPT') {
      injuryCase.medicalReceipts = [injuryCase.medicalReceipts, dto.attachments].filter(Boolean).join(',') || injuryCase.medicalReceipts;
      if (dto.amount) injuryCase.medicalExpense = Number(injuryCase.medicalExpense) + Number(dto.amount);
      await this.cases.save(injuryCase);
      if (injuryCase.injuryClaimId) {
        const claim = await this.claims.findOne({ where: { id: injuryCase.injuryClaimId } });
        if (claim) {
          claim.hospitalReceiptStatus = 'SUPPLEMENTED';
          claim.hospitalReceiptNote = dto.content.trim();
          claim.materials = { ...(claim.materials || emptyMaterials(!!injuryCase.supervisorConfirmed)), receipts: true };
          claim.lastFollowupAt = new Date();
          await this.claims.save(claim);
        }
      }
    }

    await this.addFollowupRecord(injuryCase.id, {
      type: dto.type,
      content: dto.content.trim(),
      attachments: dto.attachments || null,
      amount: dto.amount != null ? Number(dto.amount) : null,
      actorId: user.sub,
      actorName: user.name,
      actorRole: user.role as any,
    });

    return this.detail(injuryCase.id);
  }

  // ---------- 客服：登记待补资料 / 更新资料清单 ----------
  async updateMaterials(
    user: { sub: number; name: string },
    caseId: number,
    patch: Partial<NonNullable<InjuryClaim['materials']>>,
    note?: string,
  ) {
    const injuryCase = await this.getReportedCase(caseId);
    await this.patchMaterials(injuryCase, patch);
    const claim = await this.claims.findOne({ where: { id: injuryCase.injuryClaimId! } });
    if (claim) {
      const m = claim.materials || emptyMaterials(!!injuryCase.supervisorConfirmed);
      const missing = Object.entries(m).filter(([, v]) => !v).map(([k]) => k);
      claim.status = missing.length ? 'WAITING_DOCS' : 'DOCS_SUBMITTED';
      claim.lastFollowupAt = new Date();
      await this.claims.save(claim);
    }
    if (injuryCase.status === 'REPORTED') {
      injuryCase.status = 'CLAIM_TRACKING';
      await this.cases.save(injuryCase);
    }
    await this.addFollowupRecord(injuryCase.id, {
      type: 'DOC_REQUIRED',
      content: `理赔资料清单更新：${Object.entries(patch).map(([k, v]) => `${MATERIAL_LABELS[k] || k}${v ? '✓已收' : '✗待补'}`).join('、')}`
        + (note ? `；备注：${note}` : ''),
      actorId: user.sub, actorName: user.name, actorRole: 'SUPPORT',
    });
    return this.detail(injuryCase.id);
  }

  // ---------- 企业：提交责任意见 ----------
  async submitEnterpriseOpinion(
    user: { sub: number; role: string; name: string; enterpriseId?: number | null },
    caseId: number,
    dto: { opinion: string; acceptedPct?: number },
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    const job = await this.jobs.findOne({ where: { id: injuryCase.jobId } });
    if (user.enterpriseId !== job.enterpriseId) throw new ForbiddenException();
    if (!dto.opinion?.trim()) throw new BadRequestException('请填写企业责任意见');
    const pct = Math.min(100, Math.max(0, Number(dto.acceptedPct) || 0));

    injuryCase.enterpriseOpinion = dto.opinion.trim();
    injuryCase.enterpriseOpinionAt = new Date();
    if (pct > 0 && injuryCase.liability === 'PENDING') injuryCase.enterpriseLiabilityPct = pct;
    await this.cases.save(injuryCase);

    if (injuryCase.injuryClaimId) {
      const claim = await this.claims.findOne({ where: { id: injuryCase.injuryClaimId } });
      if (claim) {
        claim.enterpriseOpinionSubmitted = true;
        claim.enterpriseOpinion = `企业自认责任比例 ${pct}%：${dto.opinion.trim()}`;
        claim.materials = { ...(claim.materials || emptyMaterials(!!injuryCase.supervisorConfirmed)), enterpriseOpinion: true };
        claim.lastFollowupAt = new Date();
        await this.claims.save(claim);
      }
    }

    await this.addFollowupRecord(injuryCase.id, {
      type: 'ENTERPRISE_OPINION',
      content: `企业责任意见（自认承担比例 ${pct}%）：${dto.opinion.trim()}`,
      actorId: user.sub, actorName: user.name,
      actorRole: user.role === 'ENTERPRISE' ? 'ENTERPRISE' : 'SUPERVISOR',
    });
    return this.detail(injuryCase.id);
  }

  // ---------- 医疗垫付登记（企业/平台/工人自付） ----------
  async registerAdvance(
    user: { sub: number; role: string; name: string; enterpriseId?: number | null },
    caseId: number,
    dto: { source: InjuryCase['advanceSource']; amount: number; note?: string },
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    const job = await this.jobs.findOne({ where: { id: injuryCase.jobId } });
    if (user.role === 'ENTERPRISE' && user.enterpriseId !== job.enterpriseId) throw new ForbiddenException();
    if (user.role === 'SUPERVISOR') throw new ForbiddenException('主管账号不能登记垫付，请用企业账号');
    if (user.role === 'WORKER') throw new ForbiddenException();
    if (!(Number(dto.amount) > 0)) throw new BadRequestException('垫付金额必须大于 0');
    if (!['ENTERPRISE', 'PLATFORM', 'WORKER_SELF'].includes(dto.source)) {
      throw new BadRequestException('垫付来源无效');
    }

    injuryCase.advanceSource = dto.source;
    injuryCase.advanceAmount = Number(injuryCase.advanceAmount) + Number(dto.amount);
    injuryCase.advanceRecoveryStatus = dto.source === 'WORKER_SELF' ? 'N_A' : 'PENDING';
    injuryCase.advanceNote = dto.note?.trim() || injuryCase.advanceNote;
    await this.cases.save(injuryCase);

    await this.addFollowupRecord(injuryCase.id, {
      type: 'ADVANCE',
      content: `登记医疗垫付 ¥${Number(dto.amount).toFixed(2)}（来源：${ADVANCE_SOURCE_LABELS[dto.source]}）`
        + `${dto.note ? `；说明：${dto.note.trim()}` : ''}；垫付与日结工资分开记账，理赔结案时再行抵扣/追回`,
      amount: Number(dto.amount),
      actorId: user.sub, actorName: user.name,
      actorRole: user.role === 'SUPPORT' ? 'SUPPORT' : 'ENTERPRISE',
    });
    return this.detail(injuryCase.id);
  }

  /** 客服处理垫付追回：理赔款抵扣返还 / 免除 */
  async resolveAdvance(
    user: { sub: number; name: string },
    caseId: number,
    dto: { status: 'RECOVERED' | 'WAIVED'; note?: string },
  ) {
    const injuryCase = await this.getReportedCase(caseId);
    if (injuryCase.advanceRecoveryStatus !== 'PENDING') {
      throw new BadRequestException('当前没有待追回的垫付');
    }
    injuryCase.advanceRecoveryStatus = dto.status;
    injuryCase.advanceNote = `${injuryCase.advanceNote || ''}\n垫付处理：${dto.status === 'RECOVERED' ? '已由理赔款抵扣返还' : '平台/企业免除追回'}（${dto.note || '无'}）`.trim();
    await this.cases.save(injuryCase);
    await this.addFollowupRecord(injuryCase.id, {
      type: 'ADVANCE',
      content: dto.status === 'RECOVERED'
        ? `医疗垫付 ¥${injuryCase.advanceAmount} 已由保险理赔款抵扣返还`
        : `医疗垫付 ¥${injuryCase.advanceAmount} 予以免除追回：${dto.note || ''}`,
      amount: Number(injuryCase.advanceAmount),
      actorId: user.sub, actorName: user.name, actorRole: 'SUPPORT',
    });
    return this.detail(injuryCase.id);
  }

  // ---------- 客服：责任判定（单独跟进，不影响工资发放） ----------
  async decideLiability(
    user: { sub: number; name: string },
    caseId: number,
    dto: { liability: InjuryCase['liability']; enterprisePct?: number; note?: string },
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    if (!['ENTERPRISE', 'WORKER', 'THIRD_PARTY', 'JOINT'].includes(dto.liability)) {
      throw new BadRequestException('责任类型无效');
    }
    const pct = dto.liability === 'ENTERPRISE' ? 100
      : dto.liability === 'WORKER' || dto.liability === 'THIRD_PARTY' ? 0
        : Math.min(100, Math.max(0, Number(dto.enterprisePct) || 0));

    injuryCase.liability = dto.liability;
    injuryCase.enterpriseLiabilityPct = pct;
    injuryCase.liabilityNote = dto.note?.trim() || null;
    injuryCase.liabilityDecidedAt = new Date();
    await this.cases.save(injuryCase);

    await this.addFollowupRecord(injuryCase.id, {
      type: 'LIABILITY',
      content: `平台责任判定：${LIABILITY_LABELS[dto.liability]}`
        + (dto.liability === 'JOINT' ? `（企业承担 ${pct}%）` : '')
        + `；${dto.note?.trim() || '无补充说明'}。责任承担与日结工资分开处理`,
      actorId: user.sub, actorName: user.name, actorRole: 'SUPPORT',
    });
    return this.detail(injuryCase.id);
  }

  // ---------- 客服：追查考勤缺失对理赔的影响 ----------
  async traceAttendanceGap(
    user: { sub: number; name: string },
    caseId: number,
    dto: { result: InjuryCase['attendanceGapResult']; note?: string },
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    if (!injuryCase.attendanceGap) {
      throw new BadRequestException('该案件事故时存在有效到岗考勤，无需追查考勤缺失');
    }
    if (!['CONFIRMED_ARRIVAL', 'NO_ARRIVAL', 'UNVERIFIABLE'].includes(dto.result)) {
      throw new BadRequestException('追查结论无效');
    }

    injuryCase.attendanceGapResult = dto.result;
    injuryCase.attendanceGapNote = dto.note?.trim() || null;
    injuryCase.attendanceGapTracedAt = new Date();

    let impact: string;
    if (dto.result === 'CONFIRMED_ARRIVAL') {
      // 企业承认工人实际到岗但未按要求确认 → 保险缺口的不利后果由企业承担
      impact = '企业承认工人实际到岗但未按要求完成主管确认，导致事故时保单未生效：'
        + '保险仍不可事后补录/改赔，医疗等费用的保险缺口由企业承担，平台判定企业全责并计入风险画像';
      if (injuryCase.liability === 'PENDING') {
        injuryCase.liability = 'ENTERPRISE';
        injuryCase.enterpriseLiabilityPct = 100;
        injuryCase.liabilityNote = '企业未按要求确认到岗导致保险缺口，企业承担不利后果';
        injuryCase.liabilityDecidedAt = new Date();
      }
      if (injuryCase.injuryClaimId) {
        const claim = await this.claims.findOne({ where: { id: injuryCase.injuryClaimId } });
        if (claim) {
          claim.materials = { ...(claim.materials || emptyMaterials(false)), attendanceProof: true };
          claim.attendanceGapNote = `${claim.attendanceGapNote || ''}\n追查结论：企业承认实际到岗（未确认），保险缺口由企业承担`.trim();
          claim.lastFollowupAt = new Date();
          await this.claims.save(claim);
        }
      }
    } else if (dto.result === 'NO_ARRIVAL') {
      impact = '企业否认到岗且无其他到岗证据：事故时无有效考勤，保险不赔，按工人自身情况另作处理';
    } else {
      impact = '考勤缺失无法核实：平台保留进一步核查权利，理赔与责任暂缓，企业需补充现场证据';
    }
    await this.cases.save(injuryCase);

    await this.addFollowupRecord(injuryCase.id, {
      type: 'ATTENDANCE_TRACE',
      content: `考勤缺失追查结论：${ATTENDANCE_GAP_LABELS[dto.result]}。对理赔影响：${impact}`
        + (dto.note ? `；核查说明：${dto.note.trim()}` : ''),
      actorId: user.sub, actorName: user.name, actorRole: 'SUPPORT',
    });
    return this.detail(injuryCase.id);
  }

  // ---------- 客服：结案（保险赔付 / 拒赔确认；垫付与责任须有着落） ----------
  async close(
    user: { sub: number; name: string },
    caseId: number,
    dto: { outcome: 'SETTLED' | 'CLOSED'; payoutAmount?: number; note?: string },
  ) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    if (['SETTLED', 'CLOSED'].includes(injuryCase.status)) throw new BadRequestException('案件已结案');

    injuryCase.status = dto.outcome;
    injuryCase.closeNote = dto.note?.trim() || null;
    injuryCase.closedAt = new Date();

    if (injuryCase.injuryClaimId) {
      const claim = await this.claims.findOne({ where: { id: injuryCase.injuryClaimId } });
      if (claim) {
        if (dto.outcome === 'SETTLED') {
          if (!claim.coveredAtOccurrence) {
            throw new BadRequestException('事故时保险未生效的案件不能以保险赔付结案，可按企业责任履行后关闭案件');
          }
          const payout = Math.max(0, Number(dto.payoutAmount) || 0);
          claim.status = 'APPROVED';
          claim.payoutAmount = payout;
          injuryCase.insurancePayout = payout;
        } else {
          claim.status = claim.coveredAtOccurrence ? 'REJECTED' : claim.status;
        }
        claim.lastFollowupAt = new Date();
        await this.claims.save(claim);
      }
    }
    await this.cases.save(injuryCase);

    await this.addFollowupRecord(injuryCase.id, {
      type: 'STATUS',
      content: dto.outcome === 'SETTLED'
        ? `理赔结案：保险赔付 ¥${Number(injuryCase.insurancePayout || 0).toFixed(2)}；${dto.note?.trim() || ''}`
        : `案件关闭：${dto.note?.trim() || ''}`,
      amount: Number(injuryCase.insurancePayout || 0) || null,
      actorId: user.sub, actorName: user.name, actorRole: 'SUPPORT',
    });
    return this.detail(injuryCase.id);
  }

  // ===================== 查询 =====================
  async detail(caseId: number) {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    const job = await this.jobs.findOne({ where: { id: injuryCase.jobId } });
    const enterprise = await this.enterprises.findOne({ where: { id: injuryCase.enterpriseId } });
    const worker = await this.users.findOne({ where: { id: injuryCase.workerId } });
    const supervisor = injuryCase.confirmedBySupervisorId
      ? await this.users.findOne({ where: { id: injuryCase.confirmedBySupervisorId } })
      : null;
    const claim = injuryCase.injuryClaimId
      ? await this.claims.findOne({ where: { id: injuryCase.injuryClaimId } })
      : null;
    const policy = injuryCase.insurancePolicyId
      ? await this.policies.findOne({ where: { id: injuryCase.insurancePolicyId } })
      : null;
    const jobEvent = injuryCase.jobEventId
      ? await this.jobEvents.findOne({ where: { id: injuryCase.jobEventId } })
      : null;
    const attendance = await this.attendance.find({
      where: { assignmentId: injuryCase.assignmentId }, order: { eventTime: 'ASC' },
    });
    const settlement = await this.settlements.findOne({ where: { assignmentId: injuryCase.assignmentId } });
    const followups = await this.followups.find({ where: { caseId }, order: { id: 'ASC' } });

    return {
      ...injuryCase,
      job,
      enterprise: enterprise && { id: enterprise.id, name: enterprise.name, riskLevel: enterprise.riskLevel },
      worker: worker && { id: worker.id, name: worker.name, phone: worker.phone },
      supervisor: supervisor && { id: supervisor.id, name: supervisor.name },
      claim,
      policy,
      jobEvent,
      attendance,
      settlement,
      followups,
      missingMaterials: claim ? this.missingMaterials(claim) : [],
    };
  }

  async listForSupport() {
    const list = await this.cases.find({ order: { id: 'DESC' } });
    return this.decorateList(list);
  }

  async listForEnterprise(enterpriseId: number) {
    const list = await this.cases.find({ where: { enterpriseId }, order: { id: 'DESC' } });
    return this.decorateList(list);
  }

  async listForWorker(workerId: number) {
    const list = await this.cases.find({ where: { workerId }, order: { id: 'DESC' } });
    return this.decorateList(list);
  }

  async findByJobEvent(jobEventId: number): Promise<InjuryCase | null> {
    return this.cases.findOne({ where: { jobEventId } });
  }

  async listForAssignment(assignmentId: number) {
    const list = await this.cases.find({ where: { assignmentId: Number(assignmentId) }, order: { id: 'DESC' } });
    return Promise.all(list.map((c) => this.detail(c.id)));
  }

  /** 客服工作台统计：停滞案件、工资已结但事故未结案件 */
  async supportStats() {
    const list = await this.cases.find({ order: { id: 'DESC' } });
    const decorated = await this.decorateList(list);
    const open = decorated.filter((c) => !['SETTLED', 'CLOSED'].includes(c.status));
    return {
      total: decorated.length,
      open: open.length,
      stale: open.filter((c) => c.stale).length,
      wagesPaidButOpen: open.filter((c) => c.settlementPaid).length,
      awaitingReport: open.filter((c) => c.status === 'CONFIRMED' || c.status === 'DISPUTED').length,
      attendanceGapTracing: open.filter((c) => c.attendanceGap && c.attendanceGapResult === 'PENDING').length,
      pendingLiability: open.filter((c) => c.liability === 'PENDING').length,
    };
  }

  // ===================== 内部工具 =====================
  private async decorateList(list: InjuryCase[]) {
    if (!list.length) return [];
    const jobs = await this.jobs.find({ where: { id: In(list.map((c) => c.jobId)) } });
    const workers = await this.users.find({ where: { id: In(list.map((c) => c.workerId)) } });
    const ents = await this.enterprises.find({ where: { id: In(list.map((c) => c.enterpriseId)) } });
    const claimIds = list.map((c) => c.injuryClaimId).filter(Boolean) as number[];
    const claimRows = claimIds.length ? await this.claims.find({ where: { id: In(claimIds) } }) : [];
    const settlements = await this.settlements.find({
      where: { assignmentId: In(list.map((c) => c.assignmentId)) },
    });
    const followCounts = await this.followups
      .createQueryBuilder('f')
      .select('f.caseId', 'caseId')
      .addSelect('MAX(f.createdAt)', 'lastAt')
      .groupBy('f.caseId')
      .getRawMany<{ caseId: string; lastAt: Date }>();
    const followMap = new Map(followCounts.map((f) => [Number(f.caseId), new Date(f.lastAt)]));

    const jMap = new Map(jobs.map((j) => [j.id, j]));
    const wMap = new Map(workers.map((w) => [w.id, w]));
    const eMap = new Map(ents.map((e) => [e.id, e]));
    const cMap = new Map(claimRows.map((c) => [c.id, c]));
    const sMap = new Map(settlements.map((s) => [s.assignmentId, s]));

    return list.map((c) => {
      const claim = c.injuryClaimId ? cMap.get(c.injuryClaimId) : null;
      const settlement = sMap.get(c.assignmentId) || null;
      const lastAt = followMap.get(c.id) || c.createdAt;
      const isOpen = !['SETTLED', 'CLOSED'].includes(c.status);
      const stale = isOpen && (Date.now() - new Date(lastAt).getTime() > STALE_HOURS * 3600000);
      return {
        ...c,
        jobTitle: jMap.get(c.jobId)?.title,
        workerName: wMap.get(c.workerId)?.name || `#${c.workerId}`,
        enterpriseName: eMap.get(c.enterpriseId)?.name || `#${c.enterpriseId}`,
        claimStatus: claim?.status || null,
        missingMaterials: claim ? this.missingMaterials(claim) : [],
        settlementStatus: settlement?.status || null,
        settlementPaid: settlement ? ['PAID', 'ADJUSTED'].includes(settlement.status) : false,
        lastFollowupAt: lastAt,
        stale,
      };
    });
  }

  private missingMaterials(claim: InjuryClaim): string[] {
    const m = claim.materials || emptyMaterials(false);
    return Object.entries(m).filter(([, v]) => !v).map(([k]) => MATERIAL_LABELS[k] || k);
  }

  private async patchMaterials(injuryCase: InjuryCase, patch: Partial<NonNullable<InjuryClaim['materials']>>) {
    if (!injuryCase.injuryClaimId) throw new BadRequestException('尚未发起保险报案，无理赔资料清单');
    const claim = await this.claims.findOne({ where: { id: injuryCase.injuryClaimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    claim.materials = { ...(claim.materials || emptyMaterials(!!injuryCase.supervisorConfirmed)), ...patch };
    claim.lastFollowupAt = new Date();
    await this.claims.save(claim);
  }

  private async getReportedCase(caseId: number): Promise<InjuryCase> {
    const injuryCase = await this.cases.findOne({ where: { id: caseId } });
    if (!injuryCase) throw new NotFoundException('工伤事件不存在');
    if (!injuryCase.injuryClaimId) throw new BadRequestException('请先发起保险报案');
    return injuryCase;
  }

  private isCoveredAt(policy: InsurancePolicy, at: Date) {
    return policy.status === 'ACTIVE'
      && !!policy.effectiveFrom
      && at >= new Date(policy.effectiveFrom)
      && (!policy.effectiveTo || at <= new Date(policy.effectiveTo));
  }

  private addFollowupRecord(
    caseId: number,
    data: {
      type: InjuryCaseFollowup['type'];
      content: string;
      attachments?: string | null;
      amount?: number | null;
      actorId?: number | null;
      actorName?: string | null;
      actorRole: InjuryCaseFollowup['actorRole'];
    },
  ) {
    return this.followups.save(this.followups.create({
      caseId,
      type: data.type,
      content: data.content,
      attachments: data.attachments || null,
      amount: data.amount ?? null,
      actorId: data.actorId ?? null,
      actorName: data.actorName || null,
      actorRole: data.actorRole,
    }));
  }
}

export const MATERIAL_LABELS: Record<string, string> = {
  accidentNotice: '事故说明/报案登记表',
  medicalRecord: '病历/诊断证明',
  receipts: '医疗票据',
  attendanceProof: '考勤/到岗证明',
  supervisorStatement: '主管情况说明',
  enterpriseOpinion: '企业责任意见',
  idCopy: '工人身份证/银行卡',
};

export const LIABILITY_LABELS: Record<string, string> = {
  PENDING: '待判定',
  ENTERPRISE: '企业全责',
  WORKER: '工人自身原因',
  THIRD_PARTY: '第三方责任',
  JOINT: '多方分担',
};

export const ATTENDANCE_GAP_LABELS: Record<string, string> = {
  PENDING: '追查中',
  CONFIRMED_ARRIVAL: '企业承认实际到岗（未按要求确认）',
  NO_ARRIVAL: '确认未到岗',
  UNVERIFIABLE: '无法核实',
};

export const ADVANCE_SOURCE_LABELS: Record<string, string> = {
  ENTERPRISE: '企业垫付',
  PLATFORM: '平台先行垫付',
  WORKER_SELF: '工人自行支付',
  NONE: '无',
};
