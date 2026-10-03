import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import {
  Settlement, Job, Assignment, AttendanceEvent, JobEvent, InsurancePolicy,
  Enterprise, Appeal, User,
} from '../../entities';
import { round2, minutesBetween } from '../../geo';

const EXTRA_CARRY_FLAT = 30; // 每次已审批的额外搬运突击补贴（元）

@Injectable()
export class SettlementService {
  constructor(
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(JobEvent) private jobEvents: Repository<JobEvent>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Appeal) private appeals: Repository<Appeal>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  /**
   * 根据有效工时、加班、迟到、餐补、扣款、预付款、服务费生成/重算日结明细（幂等）
   * opts.injuryStopAt：工伤停工场景，无签退记录，以事故时间为止按「已完成工时」折算工资
   * opts.assumedStartAt：无四重到岗记录但企业承认工人实际到岗（考勤缺失追查结论）时，
   *                     以企业承认的到岗时间作为结算起点（不回写考勤表、不改变保险事实）
   */
  async generate(
    assignmentId: number,
    opts: { injuryStopAt?: Date; assumedStartAt?: Date; injuryStopReason?: string } = {},
  ): Promise<Settlement> {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!assignment) throw new BadRequestException('派单不存在');
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    if (!job) throw new BadRequestException('岗位不存在');

    const checkIn = await this.attendance.findOne({
      where: { assignmentId, kind: 'CHECK_IN', allPassed: true },
      order: { eventTime: 'ASC' },
    });
    const checkOut = await this.attendance.findOne({
      where: { assignmentId, kind: 'CHECK_OUT', allPassed: true },
      order: { eventTime: 'DESC' },
    });
    if (!checkIn && !opts.assumedStartAt) throw new BadRequestException('尚无有效到岗签到记录，无法结算');

    const scheduledStart = new Date(job.startTime);
    const scheduledEnd = new Date(job.endTime);
    const scheduledMinutes = Math.max(1, minutesBetween(scheduledStart, scheduledEnd));

    // 实际到岗时间：四重通过的签到时间；考勤缺失但企业承认到岗时用追查认定的到岗时间（仅用于结算，不改变保险事实）
    const effectiveStart = checkIn ? new Date(checkIn.eventTime) : new Date(opts.assumedStartAt!);

    // 迟到分钟（超出宽限期）
    let lateMinutes = 0;
    if (effectiveStart.getTime() > scheduledStart.getTime()) {
      lateMinutes = Math.max(0, minutesBetween(scheduledStart, effectiveStart) - (job.lateGraceMinutes || 0));
    }

    // 有效工时（日结口径）：
    // 约定班次工资对应 scheduledMinutes；迟到不减少工时（走迟到扣款）；
    // 经批准的早退按分钟折算；实际打卡时长仅作证据留存。
    const events = await this.jobEvents.find({ where: { assignmentId, status: 'APPROVED' } });
    const earlyLeaveEvent = events.find((e) => e.type === 'EARLY_LEAVE');
    const earlyLeaveMinutes = earlyLeaveEvent?.minutes || 0;
    const clockMinutes = checkOut && checkIn ? Math.max(0, minutesBetween(checkIn.eventTime, checkOut.eventTime)) : 0;
    let workMinutes: number;
    if (checkOut) {
      workMinutes = Math.max(0, scheduledMinutes - earlyLeaveMinutes);
    } else if (opts.injuryStopAt) {
      // 工伤停工未签退：日结工资先按事故发生时已完成的工时折算，医疗/责任另案跟进
      workMinutes = Math.min(
        scheduledMinutes,
        Math.max(0, minutesBetween(scheduledStart, opts.injuryStopAt)),
      );
    } else {
      workMinutes = scheduledMinutes;
    }
    void clockMinutes;

    // 已审批事件
    const overtimeMinutes = events
      .filter((e) => e.type === 'OVERTIME')
      .reduce((s, e) => s + (e.minutes || 0), 0);
    const extraCarryCount = events.filter((e) => e.type === 'EXTRA_CARRY').length;
    const extraCarryMinutes = events
      .filter((e) => e.type === 'EXTRA_CARRY')
      .reduce((s, e) => s + (e.minutes || 0), 0);

    // 金额计算
    const baseWage = round2((Number(job.dailyWage) * workMinutes) / scheduledMinutes);
    const overtimePay = round2(overtimeMinutes * (Number(job.overtimeRate) / 60));
    const extraCarryPay = round2(
      extraCarryCount * EXTRA_CARRY_FLAT + extraCarryMinutes * (Number(job.overtimeRate) / 60) * 1.5,
    );
    const mealAllowance = workMinutes >= scheduledMinutes / 2 ? Number(job.mealAllowance) : 0;
    const lateDeduction = round2(Math.min(baseWage, lateMinutes * Number(job.lateDeductPerMin)));
    const otherDeduction = 0;
    const deductionReason = [
      lateMinutes > 0 ? `迟到 ${lateMinutes} 分钟扣款` : null,
      earlyLeaveEvent ? `早退 ${earlyLeaveEvent.minutes || 0} 分钟（已按实际工时折算）` : null,
      !checkOut && opts.injuryStopAt ? `工伤停工：按事故前已完成工时 ${workMinutes} 分钟折算（医疗垫付与责任另案跟进）` : null,
    ].filter(Boolean).join('；') || null;

    const workerPayable = round2(
      baseWage + overtimePay + extraCarryPay + mealAllowance - lateDeduction - otherDeduction,
    );

    const policy = await this.policies.findOne({ where: { assignmentId } });
    // 仅实际生效过（ACTIVE/EXPIRED）的保单计收保费；PENDING/VOID（未到岗/未确认）保险从未生效，不收保费
    const insurancePremium = policy && ['ACTIVE', 'EXPIRED'].includes(policy.status) ? Number(policy.premium) : 0;
    const platformServiceFee = round2(baseWage * Number(job.platformFeeRate));
    const enterpriseCharged = round2(workerPayable + insurancePremium + platformServiceFee);

    // 企业预付款按当日实际到岗人数平摊到本单
    const checkedInCount = await this.assignments.count({
      where: { jobId: job.id, status: In(['CHECKED_IN', 'WORKING', 'COMPLETED']) },
    });
    const perHeadPrepay = checkedInCount > 0 ? Number(job.prepayment) / checkedInCount : 0;
    const prepaymentUsed = round2(Math.min(perHeadPrepay, enterpriseCharged));

    let settlement = await this.settlements.findOne({ where: { assignmentId } });
    if (!settlement) {
      settlement = this.settlements.create({ assignmentId, jobId: job.id, workerId: assignment.workerId, enterpriseId: job.enterpriseId });
    }
    Object.assign(settlement, {
      workMinutes,
      overtimeMinutes,
      lateMinutes,
      baseWage,
      overtimePay,
      extraCarryPay,
      mealAllowance,
      lateDeduction,
      otherDeduction,
      deductionReason,
      insurancePremium,
      platformServiceFee,
      enterprisePrepaymentUsed: prepaymentUsed,
      workerPayable,
      enterpriseCharged,
      status: settlement.status === 'PAID' || settlement.status === 'ADJUSTED' ? settlement.status : 'DRAFT',
    });
    return this.settlements.save(settlement);
  }

  /** 企业确认并发放日结（支持批量，按岗位） */
  async confirmAndPay(assignmentIds: number[], enterpriseId: number) {
    const list = await this.settlements.find({ where: { assignmentId: In(assignmentIds) } });
    const paid: Settlement[] = [];
    for (const s of list) {
      if (s.enterpriseId !== enterpriseId) throw new BadRequestException('不能结算其他企业的任务');
      if (s.status === 'PAID') { paid.push(s); continue; }
      s.status = 'PAID';
      s.paidAt = new Date();
      paid.push(await this.settlements.save(s));
    }
    return paid;
  }

  /** 客服/仲裁补发：在原应发上增加补发金额，保留审计痕迹 */
  async applyReissue(appeal: Appeal, amount: number, note: string): Promise<Settlement> {
    const s = await this.settlements.findOne({ where: { assignmentId: appeal.assignmentId } });
    if (!s) throw new BadRequestException('结算单不存在');
    s.workerPayable = round2(Number(s.workerPayable) + amount);
    s.enterpriseCharged = round2(Number(s.enterpriseCharged) + amount);
    s.otherDeduction = Number(s.otherDeduction); // 保留
    s.status = 'ADJUSTED';
    s.paidAt = new Date();
    s.deductionReason = s.deductionReason ? `${s.deductionReason}；申诉补发 ¥${amount}（${note}）` : `申诉补发 ¥${amount}（${note}）`;
    return this.settlements.save(s);
  }

  async listByAssignment(assignmentId: number) {
    return this.settlements.findOne({ where: { assignmentId } });
  }

  async listByJob(jobId: number) {
    return this.settlements.find({ where: { jobId }, order: { id: 'ASC' } });
  }

  async listByWorker(workerId: number) {
    return this.settlements.find({ where: { workerId }, order: { id: 'DESC' } });
  }

  /** 客服证据包：签到轨迹、主管确认、现场照片、聊天记录 */
  async buildEvidence(assignmentId: number) {
    const attendance = await this.attendance.find({ where: { assignmentId }, order: { eventTime: 'ASC' } });
    const events = await this.jobEvents.find({ where: { assignmentId }, order: { occurredAt: 'ASC' } });
    const policy = await this.policies.findOne({ where: { assignmentId } });
    const settlement = await this.settlements.findOne({ where: { assignmentId } });
    const appeal = await this.appeals.findOne({ where: { assignmentId }, order: { id: 'DESC' } });
    return { attendance, events, policy, settlement, appeal };
  }
}
