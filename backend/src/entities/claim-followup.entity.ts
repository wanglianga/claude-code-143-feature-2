import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

// 理赔跟进动作类型——保证工资结算完成后事故仍有人持续跟进
export type FollowUpType =
  | 'RECORD' // 事故现场记录
  | 'SUPERVISOR_CONFIRM' // 主管确认工伤事实
  | 'REPORT' // 客服发起保险报案
  | 'MATERIAL' // 理赔资料跟进
  | 'RECEIPT' // 医院补票
  | 'MEDICAL_ADVANCE' // 医疗垫付
  | 'ATTENDANCE_CHECK' // 考勤缺失追查
  | 'ENTERPRISE_OPINION' // 企业责任意见
  | 'LIABILITY' // 平台责任判定
  | 'ADJUST' // 保险核定（赔付/拒赔）
  | 'WAGE_SETTLED' // 日结工资按工时结算
  | 'NOTE' // 普通备注
  | 'CLOSE'; // 结案

@Entity('claim_follow_ups')
@Index(['claimId'])
export class ClaimFollowUp {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  claimId: number;

  @Column({ type: 'varchar', length: 24 })
  type: FollowUpType;

  @Column({ type: 'text' })
  content: string;

  // 附件（票据/补充资料，演示用逗号分隔的 mock 地址）
  @Column({ type: 'text', nullable: true })
  attachmentUrls: string | null;

  // 操作人：平台客服/主管/企业账号（系统自动动作为 0）
  @Column({ type: 'int', default: 0 })
  operatorId: number;

  @Column({ length: 32, default: 'SUPPORT' })
  operatorRole: string;

  @Column({ length: 32, nullable: true })
  operatorName: string | null;

  // 下一待办：避免事故无人跟进
  @Column({ length: 128, nullable: true })
  nextAction: string | null;

  @Column({ type: 'datetime', nullable: true })
  nextActionDue: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
