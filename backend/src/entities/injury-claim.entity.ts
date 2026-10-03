import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

// 工伤理赔单状态机：
// RECORDED 事故已现场记录（工人上报自动建单，主管确认工伤事实）
// REPORTED 客服已向保险公司报案
// INVESTIGATING 理赔调查/责任认定中
// MATERIALS_PENDING 理赔资料待补（医院补票等）
// APPROVED 保险核定赔付 / REJECTED 保险拒赔（事故时未生效等，不可改赔）
// CLOSED 整件关闭（赔付到账或责任/垫付全部了结）
export type ClaimStatus =
  | 'RECORDED'
  | 'REPORTED'
  | 'INVESTIGATING'
  | 'MATERIALS_PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CLOSED';

// 责任判定
export type LiabilityResult =
  | 'PENDING' // 待定
  | 'ENTERPRISE_LIABLE' // 企业有责（含考勤缺失举证不利）
  | 'WORKER_LIABLE' // 工人自身原因
  | 'SHARED' // 双方分担
  | 'NO_LIABILITY'; // 意外事件，无过错方

@Entity('injury_claims')
@Index(['jobEventId'])
@Index(['assignmentId'])
export class InjuryClaim {
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

  @Column()
  jobEventId: number;

  @Column()
  insurancePolicyId: number;

  @Column({ type: 'text' })
  injuryDesc: string;

  // ---- 事故现场六要素（工人上报时由系统快照，时间不可事后修改） ----
  // 事故时间 = 工伤作业事件 occurredAt（服务器时间）
  @Column({ type: 'datetime' })
  accidentAt: Date;

  // 事故时所在岗位（如：展台搭建-桁架组）
  @Column({ length: 64, nullable: true })
  workPosition: string | null;

  // 现场照片（演示用逗号分隔的 mock 地址）
  @Column({ type: 'text', nullable: true })
  scenePhotoUrls: string | null;

  // 就医票据（挂号/检查/药品，可后补）
  @Column({ type: 'text', nullable: true })
  medicalReceiptUrls: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  claimAmount: number;

  @Column({ type: 'varchar', length: 20, default: 'RECORDED' })
  status: ClaimStatus;

  // 事故发生时保险是否在保障期内（不可变事实，客服无法改赔）
  @Column({ type: 'boolean' })
  coveredAtOccurrence: boolean;

  // ---- 主管确认（工伤事实确认，独立于保险结论） ----
  @Column({ type: 'boolean', default: false })
  supervisorConfirmed: boolean;

  @Column({ type: 'int', nullable: true })
  supervisorConfirmedBy: number | null;

  @Column({ type: 'datetime', nullable: true })
  supervisorConfirmedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  supervisorNote: string | null;

  // ---- 保险报案（客服依据记录发起） ----
  @Column({ type: 'boolean', default: false })
  reportedToInsurer: boolean;

  @Column({ type: 'int', nullable: true })
  reportedBy: number | null;

  @Column({ type: 'datetime', nullable: true })
  reportedAt: Date | null;

  @Column({ length: 64, nullable: true })
  insurerReportNo: string | null;

  // ---- 理赔资料跟踪 ----
  @Column({ type: 'boolean', default: false })
  materialsComplete: boolean;

  @Column({ type: 'text', nullable: true })
  materialsNote: string | null;

  // ---- 医疗垫付（与日结工资分开跟进） ----
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  medicalAdvanceAmount: number;

  // 垫付方：PLATFORM 平台 / ENTERPRISE 企业 / INSURER 保险预付
  @Column({ length: 16, nullable: true })
  medicalAdvanceBy: string | null;

  @Column({ type: 'datetime', nullable: true })
  medicalAdvanceAt: Date | null;

  @Column({ type: 'text', nullable: true })
  medicalAdvanceNote: string | null;

  // ---- 责任判定（单独跟进） ----
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  liabilityResult: LiabilityResult;

  @Column({ type: 'text', nullable: true })
  liabilityNote: string | null;

  @Column({ type: 'int', nullable: true })
  liabilityDecidedBy: number | null;

  @Column({ type: 'datetime', nullable: true })
  liabilityDecidedAt: Date | null;

  // 企业责任意见（最新一条，历史在跟进时间线中）
  @Column({ type: 'text', nullable: true })
  enterpriseOpinion: string | null;

  @Column({ type: 'datetime', nullable: true })
  enterpriseOpinionAt: Date | null;

  // ---- 考勤缺失追查（企业未按要求确认到岗对理赔的影响） ----
  @Column({ type: 'boolean', default: false })
  attendanceIssue: boolean;

  @Column({ type: 'text', nullable: true })
  attendanceNote: string | null;

  @Column({ type: 'datetime', nullable: true })
  attendanceCheckedAt: Date | null;

  // ---- 日结工资按已完成工时先行结算（与医疗/责任解耦） ----
  @Column({ type: 'int', nullable: true })
  wageSettlementId: number | null;

  @Column({ type: 'datetime', nullable: true })
  wageSettledAt: Date | null;

  // ---- 结案 ----
  @Column({ type: 'datetime', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  closeNote: string | null;

  // 理赔员备注（全过程追加留痕）
  @Column({ type: 'text', nullable: true })
  adjusterNote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
