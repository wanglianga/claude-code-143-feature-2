import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export type ClaimStatus =
  | 'REPORTED' // 客服已向保险公司报案
  | 'INVESTIGATING' // 平台调查中
  | 'WAITING_DOCS' // 理赔资料待补（等待工人/医院/企业）
  | 'DOCS_SUBMITTED' // 资料已齐，等待保险审核
  | 'APPROVED' // 保险理赔通过
  | 'REJECTED'; // 不在保障范围（如事故时保险未生效）

// 理赔资料清单（勾选式跟踪，避免工资结算后无人跟进）
export interface ClaimMaterialState {
  accidentNotice: boolean; // 事故说明/报案登记表
  medicalRecord: boolean; // 病历/诊断证明
  receipts: boolean; // 医疗票据
  attendanceProof: boolean; // 考勤/到岗证明
  supervisorStatement: boolean; // 主管情况说明
  enterpriseOpinion: boolean; // 企业责任意见
  idCopy: boolean; // 工人身份证/银行卡
}

@Entity('injury_claims')
@Index(['jobEventId'])
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

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  claimAmount: number;

  @Column({ type: 'varchar', length: 16, default: 'REPORTED' })
  status: ClaimStatus;

  // 事故发生时保险是否在保障期内
  @Column({ type: 'boolean' })
  coveredAtOccurrence: boolean;

  @Column({ type: 'text', nullable: true })
  adjusterNote: string | null;

  // ---------- 保险报案（客服根据工伤记录发起） ----------
  // 报案前为空；客服提交报案后记录报案号与报案时间
  @Column({ type: 'varchar', length: 64, nullable: true })
  insurerReportNo: string | null;

  @Column({ type: 'datetime', nullable: true })
  reportedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  reportedBy: number | null;

  // ---------- 理赔资料持续跟踪 ----------
  // JSON：各项资料是否齐备
  @Column({ type: 'json', nullable: true })
  materials: ClaimMaterialState | null;

  // 医院补票状态：等待补票 / 已补 / 不需要
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  hospitalReceiptStatus: 'PENDING' | 'SUPPLEMENTED' | 'NOT_NEEDED';

  @Column({ type: 'text', nullable: true })
  hospitalReceiptNote: string | null;

  // 企业责任意见是否已提交
  @Column({ type: 'boolean', default: false })
  enterpriseOpinionSubmitted: boolean;

  @Column({ type: 'text', nullable: true })
  enterpriseOpinion: string | null;

  // 企业未按要求确认到岗 → 考勤缺失对理赔影响的追查结论
  @Column({ type: 'boolean', default: false })
  attendanceGapFlag: boolean;

  @Column({ type: 'text', nullable: true })
  attendanceGapNote: string | null;

  // 最近一次跟进时间（客服据此发现“工资结算完成后事故无人跟进”的停滞案件）
  @Column({ type: 'datetime', nullable: true })
  lastFollowupAt: Date | null;

  // 保险实际赔付金额（结案）
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  payoutAmount: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
