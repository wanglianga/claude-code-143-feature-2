import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

// 工伤/理赔跟进类型：
// DOC_REQUIRED   客服登记待补理赔资料
// DOC_SUBMITTED  工人/企业补充资料
// HOSPITAL_RECEIPT 医院补票
// SUPERVISOR_NOTE 主管补充情况
// ENTERPRISE_OPINION 企业责任意见
// ATTENDANCE_TRACE 平台追查考勤缺失
// ADVANCE 医疗垫付登记/追回
// LIABILITY 责任判定更新
// INSURER 保险公司反馈
// STATUS 案件状态流转/结案
export type ClaimFollowupType =
  | 'DOC_REQUIRED'
  | 'DOC_SUBMITTED'
  | 'HOSPITAL_RECEIPT'
  | 'SUPERVISOR_NOTE'
  | 'ENTERPRISE_OPINION'
  | 'ATTENDANCE_TRACE'
  | 'ADVANCE'
  | 'LIABILITY'
  | 'INSURER'
  | 'STATUS';

export type ClaimFollowupActorRole = 'WORKER' | 'SUPERVISOR' | 'ENTERPRISE' | 'SUPPORT' | 'SYSTEM';

@Entity('injury_case_followups')
@Index(['caseId'])
export class InjuryCaseFollowup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  caseId: number;

  @Column({ type: 'varchar', length: 24 })
  type: ClaimFollowupType;

  @Column({ type: 'text' })
  content: string;

  // 附件（票据/资料照片，多个以逗号分隔）
  @Column({ type: 'text', nullable: true })
  attachments: string | null;

  // 涉及金额（垫付/补票金额/赔付等，可选）
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  amount: number | null;

  @Column({ type: 'int', nullable: true })
  actorId: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  actorName: string | null;

  @Column({ type: 'varchar', length: 16, default: 'SUPPORT' })
  actorRole: ClaimFollowupActorRole;

  @CreateDateColumn()
  createdAt: Date;
}
