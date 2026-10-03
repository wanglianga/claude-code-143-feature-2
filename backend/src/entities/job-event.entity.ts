import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type JobEventType =
  | 'OVERTIME' // 临时加班
  | 'POSITION_CHANGE' // 岗位调换
  | 'EARLY_LEAVE' // 工人早退
  | 'EXTRA_CARRY' // 主管要求额外搬运
  | 'INJURY' // 工人受伤
  | 'JOB_CANCELLED' // 企业取消岗位
  | 'WAGE_DISPUTE' // 工资被扣争议
  | 'OTHER';

export type JobEventStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// 派单执行过程中的所有关键事件，与派单/考勤/保险/工时/结算保持在同一任务内
@Entity('job_events')
@Index(['assignmentId'])
export class JobEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  assignmentId: number;

  @Column()
  jobId: number;

  @Column()
  workerId: number;

  @Column({ type: 'varchar', length: 24 })
  type: JobEventType;

  @Column({ type: 'text' })
  description: string;

  // 事件发生时间（用于工时与保险判定，必须现场实时上报）
  @Column({ type: 'datetime' })
  occurredAt: Date;

  // 加班分钟数 / 早退分钟数
  @Column({ type: 'int', nullable: true })
  minutes: number | null;

  // 岗位调换：新岗位
  @Column({ length: 64, nullable: true })
  newPosition: string | null;

  // 受伤时所在岗位（如：展台搭建帮工-桁架组）
  @Column({ length: 64, nullable: true })
  workPosition: string | null;

  // 现场照片
  @Column({ type: 'text', nullable: true })
  photoUrl: string | null;

  // 现场照片补充（多角度，演示用逗号分隔的 mock 地址）
  @Column({ type: 'text', nullable: true })
  extraPhotoUrls: string | null;

  // 就医票据（挂号/检查/药品等，演示用逗号分隔的 mock 地址）
  @Column({ type: 'text', nullable: true })
  medicalReceiptUrls: string | null;

  // 定位（证明现场上报）
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  lat: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  lng: number | null;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status: JobEventStatus;

  @Column({ type: 'int', nullable: true })
  reviewedBy: number | null;

  @Column({ type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  reviewNote: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
