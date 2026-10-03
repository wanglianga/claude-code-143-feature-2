import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

// 工伤案件状态：DRAFT(现场记录待主管确认) → CONFIRMED(主管确认属实) → REPORTED(客服已发起保险报案)
// → CLAIM_TRACKING(理赔跟进中) → SETTLED(理赔结案) / CLOSED(关闭，如不实/撤案)
export type InjuryCaseStatus =
  | 'DRAFT' // 已现场记录，等待主管确认
  | 'CONFIRMED' // 主管确认工伤属实，等待客服报案
  | 'DISPUTED' // 主管驳回/存疑，客服可介入核查
  | 'REPORTED' // 客服已向保险公司报案
  | 'CLAIM_TRACKING' // 理赔资料跟进中
  | 'SETTLED' // 理赔结案（赔付到账或保险拒赔但责任另案处理完毕）
  | 'CLOSED';

// 责任判定（医疗垫付与责任承担单独跟进，不与日结工资混算）
export type LiabilityType =
  | 'PENDING' // 尚未判定
  | 'ENTERPRISE' // 企业有责（安全管理/劳动保护缺失）
  | 'WORKER' // 工人自身原因
  | 'THIRD_PARTY' // 第三方（场馆/甲方/其他班组）
  | 'JOINT'; // 多方分担

// 医疗垫付来源
export type AdvanceSource = 'ENTERPRISE' | 'PLATFORM' | 'WORKER_SELF' | 'NONE';

// 企业对考勤缺失的说明结论（影响理赔：无有效到岗记录则事故时保险未生效）
export type AttendanceGapResult =
  | 'PENDING' // 平台追查中
  | 'CONFIRMED_ARRIVAL' // 企业承认工人实际到岗（但未按要求确认，企业承担不利后果）
  | 'NO_ARRIVAL' // 企业否认到岗/工人确未到岗
  | 'UNVERIFIABLE'; // 无法核实

@Entity('injury_cases')
@Index(['assignmentId'])
@Index(['enterpriseId'])
export class InjuryCase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  assignmentId: number;

  @Column()
  jobId: number;

  @Column()
  workerId: number;

  @Column()
  enterpriseId: number;

  // 关联作业事件（INJURY，现场实时上报，时间取服务器时间，不可补录）
  @Column({ type: 'int', nullable: true })
  jobEventId: number | null;

  // 关联理赔调查单（向保险报案后生成/关联）
  @Column({ type: 'int', nullable: true })
  injuryClaimId: number | null;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: InjuryCaseStatus;

  // 该案件工伤是否已计入企业风险画像（防止重复确认重复计数）
  @Column({ type: 'boolean', default: false })
  riskCounted: boolean;

  // ---------- 事故现场记录（要素） ----------
  // 事故时间：= 作业事件 occurredAt（服务器时间），现场实时上报
  @Column({ type: 'datetime' })
  occurredAt: Date;

  // 事故岗位：默认岗位，岗位调换后记录实际作业岗位
  @Column({ length: 128 })
  positionAtInjury: string;

  // 受伤部位/伤情描述（如：右脚踝扭伤）
  @Column({ type: 'text' })
  injuryDesc: string;

  // 现场照片（演示：dataURL/占位标识，多张以逗号分隔）
  @Column({ type: 'text', nullable: true })
  scenePhotos: string | null;

  // 就医医院
  @Column({ length: 128, nullable: true })
  hospital: string | null;

  // 就医票据（挂号/检查/药品等，多张以逗号分隔）
  @Column({ type: 'text', nullable: true })
  medicalReceipts: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  medicalExpense: number;

  // ---------- 主管确认 ----------
  @Column({ type: 'boolean', default: false })
  supervisorConfirmed: boolean;

  @Column({ type: 'int', nullable: true })
  confirmedBySupervisorId: number | null;

  @Column({ type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  supervisorNote: string | null;

  // ---------- 保险生效状态（事故时点快照，不可变） ----------
  @Column({ type: 'int', nullable: true })
  insurancePolicyId: number | null;

  // 事故发生时保险是否在保障期内（系统按保单生效时间判定）
  @Column({ type: 'boolean', default: false })
  coveredAtOccurrence: boolean;

  // 事故时保单状态快照：PENDING/ACTIVE/EXPIRED/VOID
  @Column({ type: 'varchar', length: 16, nullable: true })
  policyStatusAtOccurrence: string | null;

  // ---------- 保险报案 ----------
  @Column({ type: 'varchar', length: 64, nullable: true })
  insurerReportNo: string | null; // 保险公司报案号

  @Column({ type: 'int', nullable: true })
  reportedBy: number | null; // 发起报案的客服

  @Column({ type: 'datetime', nullable: true })
  reportedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  reportNote: string | null;

  // ---------- 考勤缺失追查（企业未按要求确认到岗 → 对理赔的影响） ----------
  // 事故时是否缺少有效的四重到岗确认
  @Column({ type: 'boolean', default: false })
  attendanceGap: boolean;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  attendanceGapResult: AttendanceGapResult;

  @Column({ type: 'text', nullable: true })
  attendanceGapNote: string | null;

  @Column({ type: 'datetime', nullable: true })
  attendanceGapTracedAt: Date | null;

  // ---------- 医疗垫付（独立跟进，不走日结工资） ----------
  @Column({ type: 'varchar', length: 16, default: 'NONE' })
  advanceSource: AdvanceSource;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  advanceAmount: number;

  // 垫付追回状态：PENDING(待追回) / RECOVERED(理赔款已抵扣返还) / WAIVED(免除) / N_A
  @Column({ type: 'varchar', length: 16, default: 'N_A' })
  advanceRecoveryStatus: string;

  @Column({ type: 'text', nullable: true })
  advanceNote: string | null;

  // ---------- 责任判定（单独跟进） ----------
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  liability: LiabilityType;

  // 企业承担比例（0~100，企业责任意见与平台裁定口径）
  @Column({ type: 'int', default: 0 })
  enterpriseLiabilityPct: number;

  // 企业责任意见（企业在理赔跟进中提交）
  @Column({ type: 'text', nullable: true })
  enterpriseOpinion: string | null;

  @Column({ type: 'datetime', nullable: true })
  enterpriseOpinionAt: Date | null;

  @Column({ type: 'text', nullable: true })
  liabilityNote: string | null;

  @Column({ type: 'datetime', nullable: true })
  liabilityDecidedAt: Date | null;

  // ---------- 结案 ----------
  // 保险公司最终赔付金额
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  insurancePayout: number;

  @Column({ type: 'text', nullable: true })
  closeNote: string | null;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
